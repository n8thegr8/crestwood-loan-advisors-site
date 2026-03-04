const { app } = require('@azure/functions');
const { fetchFile, createBranch, commitFile, createPullRequest } = require('../services/githubService');
const { modifyHtmlWithLlm } = require('../services/llmService');
const { sendPreviewEmail } = require('../services/emailService');

app.http('webhookHandler', {
    methods: ['POST'],
    authLevel: 'function',
    handler: async (request, context) => {
        context.log('Webhook payload received.');

        try {
            const contentType = request.headers.get('content-type') || '';
            let userRequest = '';
            let assetUrls = [];
            let senderEmail = '';
            let emailSubject = '';
            let debugInfo = '[DEBUG] contentType=' + contentType + '\n';

            // Handle SendGrid Inbound Parse (multipart/form-data)
            if (contentType.includes('multipart/form-data')) {
                try {
                    const formData = await request.formData();
                    
                    const fromField = formData.get('from') || '';
                    const emailMatch = fromField.match(/<([^>]+)>/) || [null, fromField.trim()];
                    senderEmail = emailMatch[1] || fromField.trim();
                    
                    userRequest = formData.get('text') || formData.get('subject') || '';
                    emailSubject = formData.get('subject') || '';
                    
                    // Collect all keys for diagnostics
                    const allKeys = [];
                    for (const key of formData.keys()) {
                        allKeys.push(key);
                    }
                    debugInfo += 'formData keys: ' + allKeys.join(', ') + '\n';
                    
                    const attachmentsField = formData.get('attachments');
                    debugInfo += 'attachments field value: ' + JSON.stringify(attachmentsField) + '\n';
                    
                    const numAttachments = parseInt(attachmentsField || '0', 10);
                    debugInfo += 'numAttachments parsed: ' + numAttachments + '\n';
                    
                    if (numAttachments > 0) {
                        const { uploadAsset } = require('../services/azureBlobService');
                        for (let i = 1; i <= numAttachments; i++) {
                            const fileBlob = formData.get('attachment' + i);
                            debugInfo += 'attachment' + i + ' typeof=' + (typeof fileBlob) + '\n';
                            if (fileBlob !== null && fileBlob !== undefined) {
                                debugInfo += 'attachment' + i + ' constructor=' + (fileBlob.constructor ? fileBlob.constructor.name : 'none') + '\n';
                                debugInfo += 'attachment' + i + ' name=' + (fileBlob.name || 'no-name') + '\n';
                                debugInfo += 'attachment' + i + ' hasArrayBuffer=' + (typeof fileBlob.arrayBuffer === 'function') + '\n';
                                debugInfo += 'attachment' + i + ' type=' + (fileBlob.type || 'no-type') + '\n';
                                
                                if (typeof fileBlob.arrayBuffer === 'function') {
                                    const originalFilename = fileBlob.name || 'attachment' + i;
                                    const mimetype = fileBlob.type || 'application/octet-stream';
                                    const arrayBuffer = await fileBlob.arrayBuffer();
                                    const buffer = Buffer.from(arrayBuffer);
                                    debugInfo += 'attachment' + i + ' bufferSize=' + buffer.length + '\n';
                                    
                                    try {
                                        const url = await uploadAsset(buffer, originalFilename, mimetype);
                                        assetUrls.push(url);
                                        debugInfo += 'UPLOAD OK: ' + url + '\n';
                                    } catch (uploadErr) {
                                        debugInfo += 'UPLOAD FAIL: ' + uploadErr.message + '\n';
                                    }
                                } else if (typeof fileBlob === 'string') {
                                    debugInfo += 'attachment' + i + ' is a STRING (length=' + fileBlob.length + ')\n';
                                    debugInfo += 'attachment' + i + ' preview=' + fileBlob.substring(0, 200) + '\n';
                                }
                            }
                        }
                    }
                } catch (formError) {
                    debugInfo += 'FORM PARSE ERROR: ' + formError.message + '\n' + formError.stack + '\n';
                }
            } else if (contentType.includes('application/json')) {
                const body = await request.json();
                userRequest = body.request || body.text || '';
                senderEmail = body.sender || body.from || '';
                emailSubject = body.subject || '';
                if (body.assetUrls) assetUrls = body.assetUrls;
            } else {
                const text = await request.text();
                userRequest = text;
                debugInfo += 'Fell through to text handler\n';
            }

            context.log(debugInfo);

            // Sender Validation Logic
            const allowedSendersRaw = process.env.ALLOWED_SENDERS || '';
            const allowedSenders = allowedSendersRaw.split(',').map(e => e.trim().toLowerCase());
            
            if (senderEmail && allowedSenders.length > 0 && !allowedSenders.includes(senderEmail.toLowerCase())) {
                context.log('Rejected unauthorized sender: ' + senderEmail);
                return { status: 403, body: 'Sender ' + senderEmail + ' is not authorized.' };
            }

            if (!userRequest) {
                return { status: 400, body: 'User request content is required. Debug: ' + debugInfo };
            }

            // Clean quoted replies from the email body to prevent LLM confusion and false-positive approvals
            // Catch common email client quoting formats AND specifically look for our own email template text
            userRequest = userRequest.split(/(?:\r?\n\s*>|\r?\nOn .*?wrote:|\r?\n_{5,}|\r?\n-{3,}\s*Original|\nFrom:.*|\nDate:.*|Your Site Update is Ready!|Next Steps:|Click the button below to view)/i)[0].trim();

            context.log('Processing request: ' + userRequest.substring(0, 200));

            // Check if this is a reply to an existing PR preview email
            const prMatch = emailSubject.match(/\[PR\s+#(\d+)\]/i);
            const prNumber = prMatch ? parseInt(prMatch[1], 10) : null;
            const isApproval = /\b(approve|approved|looks good|lgtm|merge|go ahead|do it)\b/i.test(userRequest);
            
            if (isApproval && prNumber) {
                context.log('Approval received for PR #' + prNumber);
                const { mergePullRequest } = require('../services/githubService');
                await mergePullRequest(prNumber);
                return {
                    status: 200,
                    jsonBody: { message: 'Successfully merged PR #' + prNumber + '.' }
                };
            }

            // Send immediate acknowledgement email so they know we're working on it
            if (senderEmail) {
                context.log('Sending acknowledgment email to: ' + senderEmail);
                try {
                    const { sendAckEmail } = require('../services/emailService');
                    // We don't await this so it runs in the background and doesn't hold up processing
                    sendAckEmail(senderEmail).catch(e => context.error('Background ack email failed:', e));
                } catch (e) {
                    context.error('Failed to trigger background ack email:', e);
                }
            }

            // Push to queue for background processing
            context.log('Pushing request to Azure Storage Queue...');
            const { enqueueUpdateTask } = require('../services/azureQueueService');
            await enqueueUpdateTask({
                userRequest,
                assetUrls,
                senderEmail,
                prNumber,
                debugInfo
            });

            return {
                status: 200,
                jsonBody: {
                    message: 'Successfully queued request for processing.',
                    queued: true
                }
            };
            
        } catch (error) {
            context.error('Error processing webhook: ' + error.message + '\n' + error.stack);
            return {
                status: 500,
                body: 'Internal Server Error: ' + error.message
            };
        }
    }
});

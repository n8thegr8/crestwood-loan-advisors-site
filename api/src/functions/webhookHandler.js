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

            context.log('Processing request: ' + userRequest.substring(0, 200));

            // Check if this is a reply to an existing PR preview email
            const prMatch = emailSubject.match(/\[PR\s+#(\d+)\]/i);
            if (prMatch) {
                const prNumber = parseInt(prMatch[1], 10);
                const isApproval = /\b(approve|approved|looks good|lgtm|merge|go ahead|do it)\b/i.test(userRequest);
                
                if (isApproval) {
                    context.log('Approval received for PR #' + prNumber);
                    const { mergePullRequest } = require('../services/githubService');
                    await mergePullRequest(prNumber);
                    return {
                        status: 200,
                        jsonBody: { message: 'Successfully merged PR #' + prNumber + '.' }
                    };
                } else {
                    return {
                        status: 200,
                        jsonBody: { message: 'No approval keyword found. Reply with "Approved" to deploy.' }
                    };
                }
            }

            // 1. Fetch current HTML from staging branch
            context.log('Fetching index.html from staging branch...');
            const stagingFile = await fetchFile('staging', 'index.html');
            if (!stagingFile) {
                return { status: 500, body: 'index.html not found on staging branch.' };
            }

            // 2. Modify with LLM
            context.log('Calling LLM to modify HTML...');
            const newHtml = await modifyHtmlWithLlm(stagingFile.content, userRequest, assetUrls);

            // 3. Create unique branch from staging
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const newBranchName = 'ai-update-' + timestamp;
            
            context.log('Creating new branch: ' + newBranchName);
            await createBranch('staging', newBranchName);

            // 4. Commit updated file to new branch
            context.log('Committing changes to new branch...');
            await commitFile(
                newBranchName, 
                'index.html', 
                newHtml, 
                'Automated update from AI Site Manager\n\nRequest: ' + userRequest, 
                stagingFile.sha
            );

            // 4.5 Clean up old PRs to free up Azure environments before creating a new one
            context.log('Cleaning up old AI-generated PRs...');
            const { cleanupOldPullRequests } = require('../services/githubService');
            await cleanupOldPullRequests();

            // 5. Open Pull Request to main branch to trigger Azure Preview Environment
            context.log('Creating Pull Request...');
            const pr = await createPullRequest(
                newBranchName, 
                'main', 
                'AI Update Request: ' + userRequest.substring(0, 50), 
                '## Automated PR by AI Site Manager\n\n**User Request:**\n> ' + userRequest + '\n\n---\n**Debug Info:**\n```\n' + debugInfo + '\n```'
            );

            context.log('PR Created successfully: ' + pr.html_url);
            
            // 6. Send the preview email to the original sender immediately to prevent SendGrid timeouts
            if (senderEmail) {
                context.log('Sending preview email to: ' + senderEmail);
                try {
                    await sendPreviewEmail(senderEmail, pr.html_url, pr.number);
                } catch (emailError) {
                    context.error('Failed to send preview email: ' + emailError.message);
                }
            }
            
            return {
                status: 200,
                jsonBody: {
                    message: 'Successfully processed request and created PR. Build is starting.',
                    prUrl: pr.html_url,
                    prNumber: pr.number
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

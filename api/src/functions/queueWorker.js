const { app } = require('@azure/functions');
const { fetchFile, createBranch, commitFile, createPullRequest, getPullRequest, cleanupOldPullRequests } = require('../services/githubService');
const { modifyHtmlWithLlm } = require('../services/llmService');
const { sendPreviewEmail } = require('../services/emailService');

app.storageQueue('queueWorker', {
    queueName: 'site-update-queue',
    connection: 'AzureWebJobsStorage',
    handler: async (queueItem, context) => {
        context.log('Storage queue function processed work item');
        
        try {
            // `queueItem` might be the JSON object directly or a string depending on how it's parsed
            let payload = queueItem;
            if (typeof queueItem === 'string') {
                payload = JSON.parse(queueItem);
            }
            
            const { userRequest, assetUrls, senderEmail, prNumber, debugInfo } = payload;
            
            if (prNumber) {
                // Iterative Update Logic
                context.log(`Iterative update requested for PR #${prNumber}.`);
                
                // Fetch existing PR to get its head branch
                const prData = await getPullRequest(prNumber);
                const prBranch = prData.head.ref;
                
                // Fetch current HTML from the PR branch
                context.log(`Fetching index.html from PR branch: ${prBranch}...`);
                const prFile = await fetchFile(prBranch, 'index.html');
                if (!prFile) {
                    throw new Error(`index.html not found on branch ${prBranch}.`);
                }
                
                // Modify with LLM
                context.log('Calling LLM to iteratively modify HTML...');
                const newHtml = await modifyHtmlWithLlm(prFile.content, userRequest, assetUrls);
                
                // Commit updated file to the existing branch
                context.log('Committing iterative changes to branch...');
                await commitFile(
                    prBranch, 
                    'index.html', 
                    newHtml, 
                    'Iterative automated update from AI Site Manager\n\nRequest: ' + userRequest, 
                    prFile.sha
                );
                
                // Re-send the preview email to let them know it has been updated
                if (senderEmail) {
                    context.log('Sending iterative preview email to: ' + senderEmail);
                    await sendPreviewEmail(senderEmail, prData.html_url, prNumber);
                }
            } else {
                // New PR Logic
                context.log('Fetching index.html from staging branch...');
                const stagingFile = await fetchFile('staging', 'index.html');
                if (!stagingFile) {
                    throw new Error('index.html not found on staging branch.');
                }

                // Modify with LLM
                context.log('Calling LLM to modify HTML...');
                const newHtml = await modifyHtmlWithLlm(stagingFile.content, userRequest, assetUrls);

                // Create unique branch from staging
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const newBranchName = 'ai-update-' + timestamp;
                
                context.log('Creating new branch: ' + newBranchName);
                await createBranch('staging', newBranchName);

                // Commit updated file to new branch
                context.log('Committing changes to new branch...');
                await commitFile(
                    newBranchName, 
                    'index.html', 
                    newHtml, 
                    'Automated update from AI Site Manager\n\nRequest: ' + userRequest, 
                    stagingFile.sha
                );

                // Clean up old PRs
                context.log('Cleaning up old AI-generated PRs...');
                await cleanupOldPullRequests();

                // Open Pull Request
                context.log('Creating Pull Request...');
                const pr = await createPullRequest(
                    newBranchName, 
                    'main', 
                    'AI Update Request: ' + userRequest.substring(0, 50), 
                    '## Automated PR by AI Site Manager\n\n**User Request:**\n> ' + userRequest + '\n\n---\n**Debug Info:**\n```\n' + (debugInfo || 'None') + '\n```'
                );

                context.log('PR Created successfully: ' + pr.html_url);
                
                // Send the preview email
                if (senderEmail) {
                    context.log('Sending preview email to: ' + senderEmail);
                    await sendPreviewEmail(senderEmail, pr.html_url, pr.number);
                }
            }
        } catch (error) {
            context.error('Error processing queue item:', error.message, error.stack);
            throw error; // Let Azure Functions handle retry
        }
    }
});

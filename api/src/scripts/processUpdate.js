const fs = require('fs');
const { fetchFile, createBranch, commitFile, createPullRequest, getPullRequest, cleanupOldPullRequests } = require('../services/githubService');
const { modifyHtmlWithLlm } = require('../services/llmService');
const { sendPreviewEmail } = require('../services/emailService');

async function processUpdate() {
    try {
        const payloadStr = process.env.PAYLOAD;
        if (!payloadStr) {
            throw new Error('No PAYLOAD environment variable provided.');
        }

        const payload = JSON.parse(payloadStr);
        const { userRequest, assetUrls, senderEmail, prNumber, debugInfo } = payload;
        
        console.log('Processing update requested by:', senderEmail);

        if (prNumber) {
            // Iterative Update Logic
            console.log(`Iterative update requested for PR #${prNumber}.`);
            
            // Fetch existing PR to get its head branch
            const prData = await getPullRequest(prNumber);
            const prBranch = prData.head.ref;
            
            // Fetch current HTML from the PR branch
            console.log(`Fetching index.html from PR branch: ${prBranch}...`);
            const prFile = await fetchFile(prBranch, 'index.html');
            if (!prFile) {
                throw new Error(`index.html not found on branch ${prBranch}.`);
            }
            
            // Modify with LLM
            console.log('Calling LLM to iteratively modify HTML...');
            const newHtml = await modifyHtmlWithLlm(prFile.content, userRequest, assetUrls);
            
            // Commit updated file to the existing branch
            console.log('Committing iterative changes to branch...');
            await commitFile(
                prBranch, 
                'index.html', 
                newHtml, 
                'Iterative automated update from AI Site Manager\n\nRequest: ' + userRequest, 
                prFile.sha
            );
            
            // Re-send the preview email to let them know it has been updated
            if (senderEmail) {
                console.log('Sending iterative preview email to: ' + senderEmail);
                await sendPreviewEmail(senderEmail, prData.html_url, prNumber);
            }
        } else {
            // New PR Logic
            console.log('Fetching index.html from staging branch...');
            const stagingFile = await fetchFile('staging', 'index.html');
            if (!stagingFile) {
                throw new Error('index.html not found on staging branch.');
            }

            // Modify with LLM
            console.log('Calling LLM to modify HTML...');
            const newHtml = await modifyHtmlWithLlm(stagingFile.content, userRequest, assetUrls);

            // Create unique branch from staging
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const newBranchName = 'ai-update-' + timestamp;
            
            console.log('Creating new branch: ' + newBranchName);
            await createBranch('staging', newBranchName);

            // Commit updated file to new branch
            console.log('Committing changes to new branch...');
            await commitFile(
                newBranchName, 
                'index.html', 
                newHtml, 
                'Automated update from AI Site Manager\n\nRequest: ' + userRequest, 
                stagingFile.sha
            );

            // Clean up old PRs
            console.log('Cleaning up old AI-generated PRs...');
            await cleanupOldPullRequests();

            // Open Pull Request
            console.log('Creating Pull Request...');
            const pr = await createPullRequest(
                newBranchName, 
                'main', 
                'AI Update Request: ' + userRequest.substring(0, 50), 
                '## Automated PR by AI Site Manager\n\n**User Request:**\n> ' + userRequest + '\n\n---\n**Debug Info:**\n```\n' + (debugInfo || 'None') + '\n```'
            );

            console.log('PR Created successfully: ' + pr.html_url);
            
            // Send the preview email
            if (senderEmail) {
                console.log('Sending preview email to: ' + senderEmail);
                await sendPreviewEmail(senderEmail, pr.html_url, pr.number);
            }
        }
    } catch (error) {
        console.error('Error processing update script:', error.message, error.stack);
        process.exit(1);
    }
}

processUpdate();

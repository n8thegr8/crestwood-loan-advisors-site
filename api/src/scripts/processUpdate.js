const fs = require('fs');
const { fetchFile, resetOrCreateBranch, commitFile, createPullRequest, getPullRequest, cleanupOldPullRequests, findOpenAiStagingPr } = require('../services/githubService');
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

        const targetBranch = 'ai-staging';

        console.log('Checking for existing open AI staging PR...');
        const openPr = await findOpenAiStagingPr();
        
        let existingPrNumber = openPr ? openPr.number : null;
        let existingPrUrl = openPr ? openPr.html_url : null;
        let baseRef = 'main';

        if (openPr) {
            console.log(`Found existing PR #${existingPrNumber}. Using it as base for iterative update.`);
            baseRef = targetBranch;
        }

        // Fetch index.html
        console.log(`Fetching index.html from ${baseRef} branch...`);
        let baseFile = await fetchFile(baseRef, 'index.html');
        if (!baseFile) {
            // Fallback for first run or if file is missing
            baseFile = await fetchFile('main', 'index.html');
            if (!baseFile) throw new Error(`index.html not found on main branch.`);
        }

        // Modify with LLM
        console.log('Calling LLM to modify HTML...');
        const newHtml = await modifyHtmlWithLlm(baseFile.content, userRequest, assetUrls);

        if (!openPr) {
            // Reset ai-staging branch to point to main before pushing fresh changes
            console.log(`Resetting or creating branch ${targetBranch} from main...`);
            await resetOrCreateBranch('main', targetBranch);
        }
        
        // Fetch the SHA of the targetBranch file so we can overwrite it
        const targetFile = await fetchFile(targetBranch, 'index.html');

        console.log(`Committing changes to ${targetBranch}...`);
        await commitFile(
            targetBranch, 
            'index.html', 
            newHtml, 
            'Automated update from AI Site Manager\n\nRequest: ' + userRequest, 
            targetFile ? targetFile.sha : undefined
        );

        if (existingPrNumber) {
            console.log(`Iterative PR #${existingPrNumber} updated.`);
            if (senderEmail) {
                console.log('Sending iterative preview email to: ' + senderEmail);
                await sendPreviewEmail(senderEmail, existingPrUrl, existingPrNumber);
            }
        } else {
            console.log('Creating Pull Request...');
            const pr = await createPullRequest(
                targetBranch, 
                'main', 
                'AI Update Request: ' + userRequest.substring(0, 50), 
                '## Automated PR by AI Site Manager\n\n**User Request:**\n> ' + userRequest + '\n\n---\n**Debug Info:**\n```\n' + (debugInfo || 'None') + '\n```'
            );
            console.log('PR Created successfully: ' + pr.html_url);
            
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

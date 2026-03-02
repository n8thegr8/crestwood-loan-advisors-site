const { app } = require('@azure/functions');
const { mergePullRequest } = require('../services/githubService');

app.http('approvalLoop', {
    methods: ['POST'],
    authLevel: 'function',
    handler: async (request, context) => {
        context.log('Approval loop triggered.');

        try {
            const body = await request.json();
            const { action, prNumber } = body;

            if (!action || !prNumber) {
                return { status: 400, body: 'Missing action or prNumber in payload.' };
            }

            if (action.toUpperCase() === 'APPROVE') {
                context.log(`Approving and merging PR #${prNumber}`);
                const mergeResult = await mergePullRequest(prNumber);
                
                return {
                    status: 200,
                    jsonBody: {
                        message: `Successfully merged PR #${prNumber}`,
                        sha: mergeResult.sha
                    }
                };
            } else if (action.toUpperCase() === 'RETRY') {
                // In a future expansion, "RETRY" would re-trigger the LLM with the feedback.
                context.log(`Retry requested for PR #${prNumber}`);
                return {
                    status: 200,
                    jsonBody: {
                        message: `Noted retry for PR #${prNumber}. Admin has been notified.`
                    }
                };
            } else {
                return { status: 400, body: 'Invalid action. Must be APPROVE or RETRY.' };
            }
        } catch (error) {
            context.error(`Error in approval loop: ${error.message}`);
            return {
                status: 500,
                body: `Internal Server Error: ${error.message}`
            };
        }
    }
});

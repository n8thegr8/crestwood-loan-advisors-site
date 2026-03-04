const { Octokit } = require('@octokit/rest');

function getOctokit() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error('GITHUB_TOKEN is not defined');
    }
    return new Octokit({ auth: token });
}

function getRepoInfo() {
    const owner = process.env.GITHUB_OWNER || 'n8thegr8';
    const repo = process.env.GITHUB_REPO || 'crestwood-loan-advisors-site';
    return { owner, repo };
}

/**
 * Fetches a file from the specified branch
 */
async function fetchFile(branch, path) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    try {
        const response = await octokit.repos.getContent({
            owner,
            repo,
            path,
            ref: branch
        });

        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        return { content, sha: response.data.sha };
    } catch (error) {
        if (error.status === 404) {
            return null; // File doesn't exist
        }
        throw error;
    }
}

/**
 * Creates a new branch from a base branch, or force-resets it if it already exists.
 */
async function resetOrCreateBranch(baseBranch, targetBranch) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    // Get the SHA of the base branch
    const baseRefResponse = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${baseBranch}`,
    });
    const sha = baseRefResponse.data.object.sha;

    try {
        // Try modifying existing branch
        await octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${targetBranch}`,
            sha,
            force: true
        });
    } catch (e) {
        // Create the new branch
        await octokit.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${targetBranch}`,
            sha,
        });
    }
}

/**
 * Finds an open PR originating from the persistent ai-staging branch
 */
async function findOpenAiStagingPr() {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    const response = await octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        head: `${owner}:ai-staging`
    });

    if (response.data.length > 0) {
        return response.data[0];
    }
    return null;
}

/**
 * Commits a file to the specified branch
 */
async function commitFile(branch, path, content, message, sha = undefined) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
        branch,
        sha,
    });
}

/**
 * Opens a Pull Request from head branch to base branch
 */
async function createPullRequest(head, base, title, body) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    const response = await octokit.pulls.create({
        owner,
        repo,
        head,
        base,
        title,
        body,
    });

    return response.data;
}

/**
 * Fetches data for an existing Pull Request
 */
async function getPullRequest(pullNumber) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    const response = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
    });

    return response.data;
}

/**
 * Merges a Pull Request by its number
 */
async function mergePullRequest(pullNumber) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    const response = await octokit.pulls.merge({
        owner,
        repo,
        pull_number: pullNumber,
    });

    return response.data;
}

/**
 * Closes a Pull Request by its number
 */
async function closePullRequest(pullNumber) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    const response = await octokit.pulls.update({
        owner,
        repo,
        pull_number: pullNumber,
        state: 'closed'
    });

    return response.data;
}

/**
 * Polls the GitHub Actions API to wait for the PR's build to complete
 */
async function waitForPrBuild(prNumber, maxWaitSeconds = 300) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();
    const startTime = Date.now();
    
    // We poll every 15 seconds
    const pollIntervalMs = 15000;

    console.log(`Waiting for GitHub Actions build for PR #${prNumber} to complete...`);
    
    while ((Date.now() - startTime) < (maxWaitSeconds * 1000)) {
        try {
            // Get the head SHA for this PR to find its specific workflow run
            const prData = await octokit.pulls.get({
                owner,
                repo,
                pull_number: prNumber
            });
            const headSha = prData.data.head.sha;

            // Fetch workflow runs for this SHA
            const runs = await octokit.actions.listWorkflowRunsForRepo({
                owner,
                repo,
                head_sha: headSha,
                event: 'pull_request'
            });

            if (runs.data.total_count > 0) {
                const run = runs.data.workflow_runs[0];
                console.log(`Build Status: ${run.status} | Conclusion: ${run.conclusion}`);
                
                if (run.status === 'completed') {
                    if (run.conclusion === 'success') {
                        console.log(`Build completed successfully!`);
                        return true;
                    } else {
                        console.error(`Build finished with non-success conclusion: ${run.conclusion}`);
                        return false;
                    }
                }
            } else {
                console.log(`No workflow runs found yet for PR #${prNumber} (SHA: ${headSha}). Waiting...`);
            }
        } catch (error) {
            console.error(`Error checking build status: ${error.message}`);
        }

        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    console.warn(`Timed out waiting for PR #${prNumber} to build after ${maxWaitSeconds} seconds.`);
    return false;
}

/**
 * Cleans up old AI-generated Pull Requests to free up Azure environments
 */
async function cleanupOldPullRequests() {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    try {
        console.log('Fetching open Pull Requests to clean up...');
        const response = await octokit.pulls.list({
            owner,
            repo,
            state: 'open',
            per_page: 50
        });

        // Target PRs created by the AI (e.g., branch starts with 'ai-update-')
        const openPrs = response.data.filter(pr => pr.head.ref.startsWith('ai-update-'));
        
        for (const pr of openPrs) {
            console.log(`Closing old AI PR #${pr.number} to free up Azure staging environments.`);
            await octokit.pulls.update({
                owner,
                repo,
                pull_number: pr.number,
                state: 'closed'
            });

            // Additionally delete the reference (branch) to force Azure teardown
            try {
                await octokit.git.deleteRef({
                    owner,
                    repo,
                    ref: `heads/${pr.head.ref}`
                });
                console.log(`Deleted branch ${pr.head.ref}`);
            } catch (err) {
                console.error(`Failed to delete branch ${pr.head.ref}: ${err.message}`);
            }
        }
    } catch (error) {
        console.error('Error cleaning up old PRs:', error.message);
    }
}

module.exports = {
    fetchFile,
    resetOrCreateBranch,
    commitFile,
    createPullRequest,
    getPullRequest,
    mergePullRequest,
    closePullRequest,
    waitForPrBuild,
    cleanupOldPullRequests,
    findOpenAiStagingPr
};

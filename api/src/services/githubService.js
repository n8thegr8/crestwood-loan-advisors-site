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
 * Creates a new branch from a base branch
 */
async function createBranch(baseBranch, newBranch) {
    const octokit = getOctokit();
    const { owner, repo } = getRepoInfo();

    // Get the SHA of the base branch
    const baseRefResponse = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${baseBranch}`,
    });
    const sha = baseRefResponse.data.object.sha;

    // Create the new branch
    await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${newBranch}`,
        sha,
    });
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

module.exports = {
    fetchFile,
    createBranch,
    commitFile,
    createPullRequest,
    mergePullRequest
};

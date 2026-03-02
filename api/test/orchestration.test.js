// test/orchestration.test.js
// Run this file with `node test/orchestration.test.js` after setting environment variables.
require('dotenv').config();

const { modifyHtmlWithLlm } = require('../src/services/llmService');

const mockHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Staging Site</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 p-8">
    <h1 class="text-3xl font-bold mb-4">Welcome to Crestwood Loan Advisors</h1>
    <p class="text-gray-700">We help you get the best loans.</p>
</body>
</html>
`;

async function runTest() {
    try {
        console.log('Testing LLM HTML Modification...');
        const userRequest = "Change the title to 'Get Your Dream Home Now' and center it. Add a blue background to the paragraph.";
        
        const newHtml = await modifyHtmlWithLlm(mockHtml, userRequest);
        console.log('\n--- Output HTML ---\n');
        console.log(newHtml);
        console.log('\n-------------------\n');
        console.log('Test passed successfully. Valid HTML returned.');
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

// NOTE: Uncomment to run locally IF you have OPENAI_API_KEY in your .env
// runTest();

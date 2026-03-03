const { OpenAI } = require('openai');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

function getOpenAIClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not defined');
    }
    return new OpenAI({ apiKey });
}

/**
 * Modifies the provided HTML using an LLM based on user request and validates the output.
 */
async function modifyHtmlWithLlm(currentHtml, userRequest, assetUrls = []) {
    const openai = getOpenAIClient();
    
    const systemPrompt = `You are an expert web developer and designer.
Your task is to modify the provided HTML based on the user's request.

CRITICAL DESIGN CONSTRAINTS:
1. Preserve the existing UI, UX, and overall design language of the site.
2. ANY additions or modifications MUST seamlessly integrate with the current aesthetics.
3. DO NOT introduce new CSS frameworks (like Tailwind or Bootstrap). Analyze and reuse the existing CSS classes, HTML structure, and styling paradigms found within the document.
4. Only make the specific changes requested by the user, leaving the rest of the layout intact.

You MUST output ONLY the raw, valid HTML code representing the entire modified document. Do not include any markdown formatting wrappers like \`\`\`html.
If new assets (attachments like images, videos, documents) are provided, embed them appropriately in the HTML using their URLs.`;

    let assetsText = '';
    if (assetUrls && assetUrls.length > 0) {
        assetsText = `\n\nHere are the URLs of the new assets provided by the user. Use them in your HTML updates:\n${assetUrls.join('\n')}`;
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Current HTML:\n\n${currentHtml}\n\nUser Request: ${userRequest}${assetsText}` }
    ];

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        temperature: 0.2, // Low temperature for more deterministic code output
    });

    let newHtml = response.choices[0].message.content.trim();

    // Strip markdown formatting if the LLM accidentally includes it
    if (newHtml.startsWith('```html')) {
        newHtml = newHtml.substring(7);
        if (newHtml.endsWith('```')) {
            newHtml = newHtml.substring(0, newHtml.length - 3);
        }
    } else if (newHtml.startsWith('```')) {
        newHtml = newHtml.substring(3);
        if (newHtml.endsWith('```')) {
            newHtml = newHtml.substring(0, newHtml.length - 3);
        }
    }
    
    newHtml = newHtml.trim();

    // Validate the HTML structure using JSDOM
    try {
        const dom = new JSDOM(newHtml);
        // Basic validation: Check if essential tags exist
        if (!dom.window.document.head || !dom.window.document.body) {
            throw new Error('Generated HTML is missing <head> or <body> tags.');
        }
    } catch (error) {
        throw new Error(`LLM generated invalid HTML: ${error.message}`);
    }

    return newHtml;
}

module.exports = {
    modifyHtmlWithLlm
};

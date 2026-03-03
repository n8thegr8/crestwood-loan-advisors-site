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
2. ANY new elements MUST seamlessly integrate with the current aesthetics.
3. This site uses pure Vanilla CSS and NO external frameworks (no Tailwind, no Bootstrap). When adding complex new elements (like audio players or videos), you may inject a <style> block with custom CSS to ensure they look professionally placed with ample breathing room, or use inline styles (e.g., \`style="margin-top: 30px; margin-bottom: 30px; padding: 20px;"\`). Do not let elements crash into each other.
4. Pay strictly close attention to placement instructions. If the user asks to place an element "after" a section, ensure it is the immediate sibling after that section's container.
5. You are empowered to make creative design decisions to make the final result look beautiful and premium, as long as it matches the existing site theme.
6. Only make the specific additions/changes requested by the user, leaving the rest of the document intact.

ASSET INTEGRATION:
- If new asset URLs are explicitly provided to you in the prompt, you MUST use them as the \`src\` or \`href\` for new media elements (like <audio>, <img>, or <video>). Do not use placeholder URLs.

You MUST output ONLY the raw, valid HTML code representing the entire modified document. Do not include any markdown formatting wrappers like \`\`\`html.`;

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
        temperature: 0.3, // Allow some creative design decisions while maintaining structure
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

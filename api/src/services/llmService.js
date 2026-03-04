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
1. Preserve the existing UI, UX, and overall design language.
2. ANY new sections MUST be wrapped in a <section> tag with a <div class="container"> inside it to maintain consistent horizontal alignment and margins across the site.
3. Use the site's standard section headers:
   - Wrap section titles in a <div class="section-header">.
   - Use <h3> for the main section title and <p> for the subtitle if requested.
4. Ensure ample vertical spacing. New sections should typically have "padding: 80px 0;" or "padding: 100px 0;" to match the rest of the site's breathing room.
5. This site uses Vanilla CSS. Adhere to the variables defined in :root (e.g., --primary-color, --accent-color, --font-heading, --font-body, --bg-body, --bg-card, --border-subtle, --shadow-sm, --shadow-md, --shadow-lg).
6. When adding interactive elements like <audio> or <video>, ensure they are centered and styled to look premium (e.g., using max-width, margin: 0 auto, and subtle shadows).
7. Only make the specific additions/changes requested by the user, leaving the rest of the document intact.

ASSET INTEGRATION:
- If new asset URLs are explicitly provided to you in the prompt AND the user's request explicitly asks you to add them (e.g. "add this image" or "use this audio"), you MUST use them as the \`src\` or \`href\` for new media elements.
- HOWEVER, if the user provides an image but their request is just asking for a styling fix or pointing out a bug (e.g. "remove the shadow", "fix the alignment"), DO NOT replace existing valid media URLs with the new image URL. The user is just attaching a screenshot for your reference! Leave existing media \`src\` values alone unless explicitly told to change them.

You MUST output ONLY the raw, valid HTML code representing the entire modified document. Do not include any markdown formatting wrappers like \`\`\`html.`;

    let assetsText = '';
    if (assetUrls && assetUrls.length > 0) {
        assetsText = `\n\nHere are the URLs of the new assets provided by the user. Use them in your HTML updates:\n${assetUrls.join('\n')}`;
    }

    // Try to include styles.css content for context
    let stylesContext = '';
    try {
        const fs = require('fs');
        const path = require('path');
        // From api/src/services/llmService.js to project root
        const stylesPath = path.join(__dirname, '..', '..', '..', 'styles.css');
        if (fs.existsSync(stylesPath)) {
            stylesContext = `\n\nExisting Styles (for reference only, do not output this):\n${fs.readFileSync(stylesPath, 'utf8')}`;
        }
    } catch (e) {
        // Ignore if we can't read it
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Current HTML:\n\n${currentHtml}${stylesContext}\n\nUser Request: ${userRequest}${assetsText}` }
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

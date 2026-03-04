const sgMail = require('@sendgrid/mail');

function getSendGridClient() {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
        throw new Error('SENDGRID_API_KEY is not defined');
    }
    sgMail.setApiKey(apiKey);
    return sgMail;
}

/**
 * Sends an email response back to the user with the PR and staging link.
 */
async function sendPreviewEmail(toEmail, prUrl, prNumber) {
    const sg = getSendGridClient();
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'changes@updates.natemaxfield.com';

    // The Azure Preview URL format is highly predictable based on the Azure App ID + Region
    const previewUrl = `https://blue-mud-0763ba80f-${prNumber}.eastus2.2.azurestaticapps.net`;

    // The Azure Preview URL format is typically based on the default hostname and PR number
    // E.g., https://blue-mud-0763ba80f.2.azurestaticapps.net
    // Becomes: https://blue-mud-0763ba80f-pr-5.centralus.azurestaticapps.net
    
    // As a robust fallback, we send them to the PR page where Azure explicitly comments the exact URL.
    const msg = {
        to: toEmail,
        from: fromEmail,
        subject: `Your Site Update is Ready for Review! [PR #${prNumber}]`,
        text: `Your requested changes have been processed by the AI Site Manager.\n\nA Secure Preview Environment has been automatically generated for you to review the changes before they go live.\n\nPlease visit your live Preview URL:\n${previewUrl}\n\nIf everything looks good, respond to this email with "Approved" and I will push it live!\n\n(Advanced: View GitHub Pull Request Data - ${prUrl})`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #2b6cb0;">Your Site Update is Ready!</h2>
                <p>Hello,</p>
                <p>Your requested changes have been processed by the AI Site Manager. We've compiled the code and spun up a secure staging server just for you.</p>
                
                <div style="background-color: #f7fafc; padding: 15px; border-left: 4px solid #4299e1; margin: 20px 0;">
                    <strong>Next Steps:</strong>
                    <ol>
                        <li>Click the button below to view the live preview of the site.</li>
                        <li><strong>Note:</strong> It usually takes Azure 1-2 minutes to finish booting the staging server. If you see a "404 Not Found" page, just wait 60 seconds and refresh!</li>
                        <li>Review the live site. If everything looks good, <strong>Respond to this email with "Approved" and I will push it live!</strong></li>
                    </ol>
                </div>

                <a href="${previewUrl}" style="display: inline-block; background-color: #2b6cb0; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Live Preview</a>
                
                <p style="margin-top: 30px; font-size: 12px; color: #718096;">
                    * This is an automated message from your AI Site Manager.<br>
                    <a href="${prUrl}" style="color: #a0aec0;">Advanced: View GitHub Pull Request Data</a>
                </p>
            </div>
        `
    };

    try {
        await sg.send(msg);
        console.log(`Preview email successfully sent to ${toEmail}`);
    } catch (error) {
        console.error('Error sending preview email via SendGrid:', error);
        if (error.response) {
            console.error(error.response.body);
        }
        throw error;
    }
}

/**
 * Sends an immediate acknowledgement email so the user knows the AI received their request.
 */
async function sendAckEmail(toEmail) {
    const sg = getSendGridClient();
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'changes@updates.natemaxfield.com';

    const msg = {
        to: toEmail,
        from: fromEmail,
        subject: `Processing Your Request...`,
        text: `We've received your request and the AI Site Manager is currently analyzing it and writing the code.\n\nThis usually takes about 2-3 minutes. You will receive another email as soon as the live Preview is ready for your review!`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #2b6cb0;">Processing Your Request... 🤖</h2>
                <p>Hello,</p>
                <p>We've received your request and the AI Site Manager is currently analyzing it and writing the code.</p>
                
                <div style="background-color: #f7fafc; padding: 15px; border-left: 4px solid #4299e1; margin: 20px 0;">
                    <strong>Next Steps:</strong>
                    <ol>
                        <li>Hang tight! This usually takes about <strong>2-3 minutes</strong> depending on the complexity of the changes.</li>
                        <li>You will receive another email as soon as the live Preview is ready for your review!</li>
                    </ol>
                </div>
                
                <p style="margin-top: 30px; font-size: 12px; color: #718096;">
                    * This is an automated message from your AI Site Manager.
                </p>
            </div>
        `
    };

    try {
        await sg.send(msg);
        console.log(`Ack email successfully sent to ${toEmail}`);
    } catch (error) {
        console.error('Error sending ack email via SendGrid:', error);
    }
}

module.exports = {
    sendPreviewEmail,
    sendAckEmail
};

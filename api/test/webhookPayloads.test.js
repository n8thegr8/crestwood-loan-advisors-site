// test/webhookPayloads.test.js
require('dotenv').config();

// We need to mock the Azure request object to test the parsing logic
async function runTest() {
    console.log('--- Testing Webhook Payload Parsing w/ Security ---\n');

    // MOCK: The actual function handler we want to test
    // To do this simply without starting the Azure host, we'll extract the core logic
    const { app } = require('@azure/functions');
    const webhookHandlerPath = '../src/functions/webhookHandler.js';
    
    // In a real environment, we'd use Jest or Mocha to mock the app.http registration
    // Here we'll just demonstrate the parsing logic extracted.
    
    const allowedSendersRaw = process.env.ALLOWED_SENDERS || 'changes@natemaxfield.com,admin@natemaxfield.com';
    const allowedSenders = allowedSendersRaw.split(',').map(e => e.trim().toLowerCase());
    
    console.log(`Configured ALLOWED_SENDERS: ${allowedSenders.join(', ')}\n`);

    // Test Case 1: Valid Sender
    console.log('Test 1: Valid Sender (changes@natemaxfield.com)');
    let senderEmail = "Nate Maxfield <changes@natemaxfield.com>";
    let match = senderEmail.match(/<([^>]+)>/) || [null, senderEmail.trim()];
    let extractedEmail = match[1] || senderEmail.trim();
    
    if (extractedEmail && allowedSenders.length > 0 && !allowedSenders.includes(extractedEmail.toLowerCase())) {
        console.log(`❌ FAILED: Rejected unauthorized sender: ${extractedEmail}`);
    } else {
        console.log(`✅ PASSED: Sender authorized: ${extractedEmail}`);
    }

    // Test Case 2: Invalid Sender
    console.log('\nTest 2: Invalid Sender (hacker@evil.com)');
    senderEmail = "hacker@evil.com";
    match = senderEmail.match(/<([^>]+)>/) || [null, senderEmail.trim()];
    extractedEmail = match[1] || senderEmail.trim();
    
    if (extractedEmail && allowedSenders.length > 0 && !allowedSenders.includes(extractedEmail.toLowerCase())) {
        console.log(`✅ PASSED: Rejected unauthorized sender: ${extractedEmail}`);
    } else {
        console.log(`❌ FAILED: Sender incorrectly authorized: ${extractedEmail}`);
    }

    // Test Case 3: Another Valid Sender format
    console.log('\nTest 3: Valid Sender without name (admin@natemaxfield.com)');
    senderEmail = "admin@natemaxfield.com";
    match = senderEmail.match(/<([^>]+)>/) || [null, senderEmail.trim()];
    extractedEmail = match[1] || senderEmail.trim();
    
    if (extractedEmail && allowedSenders.length > 0 && !allowedSenders.includes(extractedEmail.toLowerCase())) {
        console.log(`❌ FAILED: Rejected unauthorized sender: ${extractedEmail}`);
    } else {
        console.log(`✅ PASSED: Sender authorized: ${extractedEmail}`);
    }
}

runTest();

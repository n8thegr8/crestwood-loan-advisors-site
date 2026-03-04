const { QueueClient } = require('@azure/storage-queue');

async function enqueueUpdateTask(payload) {
    const connectionString = process.env.AzureWebJobsStorage;
    const queueName = 'site-update-queue';
    
    if (!connectionString) {
        throw new Error('AzureWebJobsStorage connection string not found.');
    }
    
    const queueClient = new QueueClient(connectionString, queueName);
    
    await queueClient.createIfNotExists();
    
    const messageText = Buffer.from(JSON.stringify(payload)).toString('base64');
    
    await queueClient.sendMessage(messageText);
}

module.exports = {
    enqueueUpdateTask
};

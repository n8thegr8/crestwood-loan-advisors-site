#!/bin/bash

# Configuration
RG="rg-crestwood-loan-advisors"
APP_NAME="crestwood-loan-advisors-site"

echo "Setting up Azure environment variables for AI Site Manager..."
echo "You will be prompted to enter your sensitive keys."

# Get user inputs for secrets
read -p "Enter your OpenAI API Key (sk-...): " OPENAI_KEY
read -p "Enter your GitHub Personal Access Token (ghp_...): " GITHUB_TOKEN
read -p "Enter your allowed sender emails (comma-separated, e.g. changes@natemaxfield.com): " ALLOWED_SENDERS
read -p "Enter your SendGrid API Key (SG....): " SENDGRID_KEY

# Set the environment variables in Azure Static Web Apps
echo "Configuring App Settings in Azure..."
az staticwebapp appsettings set \
  --name $APP_NAME \
  --resource-group $RG \
  --setting-names \
    "OPENAI_API_KEY=$OPENAI_KEY" \
    "GITHUB_TOKEN=$GITHUB_TOKEN" \
    "GITHUB_OWNER=n8thegr8" \
    "GITHUB_REPO=crestwood-loan-advisors-site" \
    "ALLOWED_SENDERS=$ALLOWED_SENDERS" \
    "AZURE_STORAGE_CONNECTION_STRING=$AZURE_STORAGE_CONNECTION_STRING" \
    "AZURE_STORAGE_CONTAINER_NAME=assets" \
    "SENDGRID_API_KEY=$SENDGRID_KEY"

echo "✅ App Settings successfully published to Azure!"
echo "Your AI Site Manager background processes are now fully functional."

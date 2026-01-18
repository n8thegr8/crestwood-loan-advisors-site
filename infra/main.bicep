param location string = 'eastus2'
param skuName string = 'Free'
param skuTier string = 'Free'
param staticSiteName string = 'finecut-site'

resource staticSite 'Microsoft.Web/staticSites@2022-03-01' = {
  name: staticSiteName
  location: location
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {}
}

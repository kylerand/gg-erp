output "api_gateway_url" {
  value = module.api_gateway_lambda.api_base_url
}

output "web_url" {
  value = module.amplify_hosting.web_url
}

output "floor_tech_url" {
  value = module.amplify_hosting.floor_tech_url
}

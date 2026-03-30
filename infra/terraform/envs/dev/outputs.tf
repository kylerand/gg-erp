output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "api_gateway_url" {
  value = module.api_gateway_lambda.api_base_url
}

output "event_bus_name" {
  value = module.eventbridge.event_bus_name
}

output "web_url" {
  description = "Employee web dashboard URL"
  value       = "https://main.placeholder.amplifyapp.com" # TODO: restore module.amplify_hosting.web_url
}

output "floor_tech_url" {
  description = "Floor tech mobile interface URL"
  value       = "https://main.placeholder.amplifyapp.com" # TODO: restore module.amplify_hosting.floor_tech_url
}

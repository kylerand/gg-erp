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
  value       = length(module.amplify_hosting) > 0 ? module.amplify_hosting[0].web_url : "not deployed"
}

output "floor_tech_url" {
  description = "Floor tech mobile interface URL"
  value       = length(module.amplify_hosting) > 0 ? module.amplify_hosting[0].floor_tech_url : "not deployed"
}

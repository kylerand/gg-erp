output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "api_gateway_url" {
  value = module.api_gateway_lambda.api_base_url
}

output "event_bus_name" {
  value = module.eventbridge.event_bus_name
}

output "user_pool_id" {
  description = "Cognito user pool ID"
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN"
  value       = aws_cognito_user_pool.this.arn
}

output "app_client_ids" {
  description = "Cognito app client IDs keyed by app_client_names entry"
  value = {
    for client_name, client in aws_cognito_user_pool_client.this :
    client_name => client.id
  }
}

output "domain" {
  description = "Hosted UI domain for Cognito auth endpoints"
  value       = local.domain
}

output "issuer_url" {
  description = "JWT issuer URL for the Cognito user pool"
  value       = local.issuer_url
}

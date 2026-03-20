variable "name_prefix" {
  type        = string
  description = "Prefix for all resource names"
}

variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "CIDR block for the VPC"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
  description = "CIDR blocks for public subnets (NAT gateway)"
}

variable "private_subnet_cidrs" {
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
  description = "CIDR blocks for private subnets (Lambda + Aurora)"
}

variable "availability_zones" {
  type        = list(string)
  default     = ["us-east-2a", "us-east-2b"]
  description = "AZs to deploy subnets into"
}

variable "single_nat_gateway" {
  type        = bool
  default     = true
  description = "Use a single NAT gateway (cost-saving for dev). Set false in prod for per-AZ."
}

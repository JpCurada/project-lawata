variable "region" {
  type    = string
  default = "us-west-2" # same region as Sentinel-2 COGs on AWS Open Data
}

variable "image_tag" {
  type        = string
  description = "Tag pushed to both ECR repos by scripts/push_images.sh"
  default     = "latest"
}

variable "bedrock_model_id" {
  type        = string
  description = "Claude inference profile ID from the Bedrock console (starts with us.)"
}

variable "database_url_param" {
  type        = string
  description = "Name of the SSM SecureString holding the Neon DATABASE_URL (created by hand, never in state)"
  default     = "/lawata/database_url"
}

variable "alert_email" {
  type        = string
  description = "Gets AWS Budget emails at $5 and $20 per month"
}

variable "max_candidates_per_run" {
  type    = number
  default = 10
}

variable "cognito_domain_prefix" {
  type        = string
  description = "Hosted UI prefix, <prefix>.auth.<region>.amazoncognito.com. Globally unique across AWS."

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", var.cognito_domain_prefix)) && !can(regex("aws|amazon|cognito", var.cognito_domain_prefix))
    error_message = "Use lowercase letters, digits and hyphens (max 63, no leading/trailing hyphen) and avoid the reserved words aws, amazon, cognito."
  }
}

variable "web_domain" {
  type        = string
  description = "CloudFront domain of the web app (terraform output -raw cloudfront_domain). Null on the very first apply; see infra/cognito.tf for why it is a variable."
  default     = null
}

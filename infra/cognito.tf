# Researcher sign-in (see docs/auth-contract.md). Invite-only: no self sign-up.
#
# Dependency note: the API Lambda needs the app client id, and CloudFront needs the API
# Lambda URL, so the client cannot reference aws_cloudfront_distribution.web for its
# callback URLs without a cycle (client -> CloudFront -> Lambda URL -> Lambda -> client).
# The CloudFront domain therefore comes from var.web_domain; the check block below warns
# when it is unset or does not match the real distribution.

locals {
  web_origins       = concat(["http://localhost:5173"], var.web_domain == null ? [] : ["https://${var.web_domain}"])
  cognito_authority = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.researchers.id}"
}

resource "aws_cognito_user_pool" "researchers" {
  name                = "lawata-researchers"
  user_pool_tier      = "LITE" # classic hosted UI + groups are enough; 10k MAU free
  deletion_protection = "INACTIVE"

  # Admin picks a readable username (it becomes cognito:username, the reviewer name);
  # the verified email works as a sign-in alias.
  alias_attributes         = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "Your Lawata researcher account"
      email_message = "You have been invited to the Lawata researcher area. Username: {username} Temporary password: {####} You will be asked to choose a new password at first sign-in."
      sms_message   = "Lawata researcher invite. Username: {username} Temporary password: {####}"
    }
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_group" "researchers" {
  name         = "researchers"
  user_pool_id = aws_cognito_user_pool.researchers.id
  description  = "Can see agent decisions, review plumes and approve sampling tasks"
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "lawata-web"
  user_pool_id = aws_cognito_user_pool.researchers.id

  generate_secret                      = false # public SPA client, authorization code + PKCE
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"] # sign-in happens on the hosted UI
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true

  callback_urls = [for origin in local.web_origins : "${origin}/auth/callback"]
  logout_urls   = [for origin in local.web_origins : "${origin}/"]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "hosted_ui" {
  domain                = var.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.researchers.id
  managed_login_version = 1 # classic hosted UI; v2 would need a branding resource
}

check "web_domain_matches_cloudfront" {
  assert {
    condition     = var.web_domain == aws_cloudfront_distribution.web.domain_name
    error_message = "var.web_domain must equal the CloudFront domain (terraform output -raw cloudfront_domain), otherwise hosted UI sign-in from the deployed site is rejected. Set it in terraform.tfvars and apply again."
  }
}

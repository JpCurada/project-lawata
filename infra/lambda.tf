locals {
  lambda_image = "${aws_ecr_repository.lambda.repository_url}:${var.image_tag}"
  common_env = {
    DATABASE_URL_PARAM = var.database_url_param
    LAWATA_BUCKET      = aws_s3_bucket.evidence.bucket
  }
}

resource "aws_lambda_function" "scan" {
  function_name                  = "lawata-scan"
  role                           = aws_iam_role.scan.arn
  package_type                   = "Image"
  image_uri                      = local.lambda_image
  architectures                  = ["arm64"]
  memory_size                    = 3008
  timeout                        = 300
  reserved_concurrent_executions = 1 # never more than one scan at a time
  image_config { command = ["lawata.detection.handler.handler"] }
  environment {
    variables = merge(local.common_env, {
      AGENT_RUNTIME_ARN      = aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn
      MAX_CANDIDATES_PER_RUN = tostring(var.max_candidates_per_run)
    })
  }
}

resource "aws_lambda_function" "api" {
  function_name = "lawata-api"
  role          = aws_iam_role.api.arn
  package_type  = "Image"
  image_uri     = local.lambda_image
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = 15
  image_config { command = ["lawata.api.app.handler"] }
  environment {
    # AUTH_DISABLED is deliberately never set here (the API refuses it inside Lambda anyway).
    variables = merge(local.common_env, {
      COGNITO_REGION       = var.region
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.researchers.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
    })
  }
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE" # fronted by CloudFront at /api/*
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = toset(["lawata-scan", "lawata-api"])
  name              = "/aws/lambda/${each.key}"
  retention_in_days = 7
}

# Daily wake-up at 12:00 Manila; the scan exits early if there is no new clear pass.
resource "aws_iam_role" "scheduler" {
  name = "lawata-scheduler"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "scheduler.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "lawata-scheduler-invoke-scan"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.scan.arn }]
  })
}

resource "aws_scheduler_schedule" "daily_scan" {
  name                         = "lawata-daily-scan"
  schedule_expression          = "cron(0 12 * * ? *)"
  schedule_expression_timezone = "Asia/Manila"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.scan.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

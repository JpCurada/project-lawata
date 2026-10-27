data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "agentcore_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

# Scan Lambda: read data, write crops, call the agent runtime
resource "aws_iam_role" "scan" {
  name               = "lawata-scan"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "scan_logs" {
  role       = aws_iam_role.scan.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "scan" {
  name = "lawata-scan-access"
  role = aws_iam_role.scan.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.evidence.arn}/*" },
      { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = data.aws_ssm_parameter.database_url.arn },
      {
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeAgentRuntime", "bedrock-agentcore:StopRuntimeSession"]
        Resource = [aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn, "${aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn}/*"]
      },
    ]
  })
}

# API Lambda: read Neon and evidence crops
resource "aws_iam_role" "api" {
  name               = "lawata-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "api" {
  name = "lawata-api-access"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.evidence.arn}/*" },
      { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = data.aws_ssm_parameter.database_url.arn },
    ]
  })
}

# Agent runtime: pull image, call Claude, read Neon, write crops, logs and traces
resource "aws_iam_role" "agent" {
  name               = "lawata-agent-runtime"
  assume_role_policy = data.aws_iam_policy_document.agentcore_trust.json
}

resource "aws_iam_role_policy" "agent" {
  name = "lawata-agent-runtime-access"
  role = aws_iam_role.agent.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], Resource = aws_ecr_repository.agent.arn },
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = ["arn:aws:bedrock:*::foundation-model/*", "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/*"]
      },
      { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = data.aws_ssm_parameter.database_url.arn },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.evidence.arn}/*" },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams", "logs:DescribeLogGroups"]
        Resource = "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/*"
      },
      { Effect = "Allow", Action = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "cloudwatch:PutMetricData"], Resource = "*" },
    ]
  })
}

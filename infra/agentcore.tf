# Lean AgentCore: Runtime only (tools run in-process), short lifecycle so idle sessions stop billing.
resource "aws_bedrockagentcore_agent_runtime" "agent" {
  agent_runtime_name = "lawata_agent"
  description        = "Lawata plume triage agent: one session per candidate"
  role_arn           = aws_iam_role.agent.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${aws_ecr_repository.agent.repository_url}:${var.image_tag}"
    }
  }

  network_configuration {
    network_mode = "PUBLIC" # no VPC, no NAT cost
  }

  lifecycle_configuration = [{
    idle_runtime_session_timeout = 60  # default is 900
    max_lifetime                 = 300 # default is 28800
  }]

  environment_variables = {
    BEDROCK_MODEL_ID   = var.bedrock_model_id
    DATABASE_URL_PARAM = var.database_url_param
    LAWATA_BUCKET      = aws_s3_bucket.evidence.bucket
  }

  depends_on = [aws_iam_role_policy.agent]
}

resource "aws_cloudwatch_log_group" "agent" {
  name              = "/aws/bedrock-agentcore/runtimes/${aws_bedrockagentcore_agent_runtime.agent.agent_runtime_id}-DEFAULT"
  retention_in_days = 7
}

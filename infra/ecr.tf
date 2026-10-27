resource "aws_ecr_repository" "lambda" {
  name                 = "lawata-lambda"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_repository" "agent" {
  name                 = "lawata-agent"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "keep_recent" {
  for_each   = { lambda = aws_ecr_repository.lambda.name, agent = aws_ecr_repository.agent.name }
  repository = each.value
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the 5 most recent images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
    }]
  })
}

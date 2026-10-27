resource "aws_s3_bucket" "evidence" {
  bucket_prefix = "lawata-evidence-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    id     = "expire-crops"
    status = "Enabled"
    filter { prefix = "crops/" }
    expiration { days = 90 }
  }
}

data "aws_ssm_parameter" "database_url" {
  name            = var.database_url_param
  with_decryption = false # only the ARN is needed here; Lambdas read the value at runtime
}

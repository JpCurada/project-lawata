terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Local state by default. For team use, create an S3 bucket once and uncomment:
  # backend "s3" {
  #   bucket       = "lawata-tfstate-<account-id>"
  #   key          = "lawata/terraform.tfstate"
  #   region       = "us-west-2"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "lawata", managed_by = "terraform" }
  }
}

data "aws_caller_identity" "current" {}

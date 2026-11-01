# Aiven for PostgreSQL — managed, backed-up mirror for Darkness AI conversations.
#
#   cd deploy/aiven
#   export TF_VAR_aiven_api_token=...        # PowerShell: $env:TF_VAR_aiven_api_token = "..."
#   terraform init && terraform apply
#
# Then copy the two outputs into your host's environment variables (see DEPLOY.md):
#   terraform output -raw service_uri      -> AIVEN_PG_URI   (marked sensitive)
#   the project CA certificate (Aiven console → Project → CA certificate) -> AIVEN_CA_CERT
#
# NOTE: written against the aiven/aiven provider v4.x. Run `terraform validate` before applying.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aiven = {
      source  = "aiven/aiven"
      version = "~> 4.0"
    }
  }
}

provider "aiven" {
  api_token = var.aiven_api_token
}

resource "aiven_pg" "darkness" {
  project      = var.project
  cloud_name   = var.cloud_name
  plan         = var.plan
  service_name = var.service_name

  termination_protection = true

  pg_user_config {
    pg_version = "16"

    # Only the addresses you list may connect. Use your Render outbound IPs (Render dashboard →
    # service → Connect → Outbound) and your own admin IP. Never leave 0.0.0.0/0 in production.
    dynamic "ip_filter_object" {
      for_each = var.allowed_cidrs
      content {
        network     = ip_filter_object.value
        description = "allowed client"
      }
    }

    pg {
      idle_in_transaction_session_timeout = 60000
    }
  }
}

resource "aiven_pg_database" "darkness" {
  project       = var.project
  service_name  = aiven_pg.darkness.service_name
  database_name = "darkness"
}

resource "aiven_pg_user" "app" {
  project      = var.project
  service_name = aiven_pg.darkness.service_name
  username     = "darkness_app"
}

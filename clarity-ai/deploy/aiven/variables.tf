variable "aiven_api_token" {
  description = "Aiven API token (Aiven console → User information → Tokens). Pass via TF_VAR_aiven_api_token; never commit it."
  type        = string
  sensitive   = true
}

variable "project" {
  description = "Aiven project name"
  type        = string
}

variable "cloud_name" {
  description = "Cloud/region, e.g. google-asia-south1 (Mumbai) or do-sgp (Singapore). Choose the one nearest your backend."
  type        = string
  default     = "google-asia-south1"
}

variable "plan" {
  description = "Service plan. Aiven's free tier plan is 'free-1-5gb' where available; otherwise start with 'startup-4'."
  type        = string
  default     = "startup-4"
}

variable "service_name" {
  type    = string
  default = "darkness-pg"
}

variable "allowed_cidrs" {
  description = "CIDR ranges allowed to connect to the database"
  type        = list(string)
  default     = []
}

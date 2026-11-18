variable "project_id" {
  description = "Host Google Cloud Project ID where BigQuery datasets and Cloud Run are deployed."
  type        = string
}

variable "region" {
  description = "Google Cloud region for the Cloud Run service."
  type        = string
  default     = "us-central1"
}

variable "bq_location" {
  description = "BigQuery multi-region or region location (e.g., US, EU, us-central1). Must match billing_export_table location if set."
  type        = string
  default     = "US"
}

variable "container_image" {
  description = "Container image URI built from the repository Dockerfile (e.g., us-central1-docker.pkg.dev/PROJECT/REPO/antigravity-usage-dashboard:latest)."
  type        = string
}

variable "service_name" {
  description = "Name of the Cloud Run v2 service."
  type        = string
  default     = "antigravity-usage-dashboard"
}

variable "org_id" {
  description = "Google Cloud Organization ID for creating an aggregated org-wide Cloud Logging sink (recommended). Leave empty if using folder_id or single-project sink."
  type        = string
  default     = ""
}

variable "folder_id" {
  description = "Optional GCP Folder ID if scoping the Cloud Logging sink to a folder instead of the entire Organization."
  type        = string
  default     = ""
}

variable "org_domain" {
  description = "Workspace domain displayed in the UI header (e.g., example.com)."
  type        = string
  default     = ""
}

variable "org_timezone" {
  description = "IANA timezone used to bucket the 7x24 engineering velocity heatmap (e.g., UTC, America/New_York, Europe/London)."
  type        = string
  default     = "UTC"
}

variable "monitoring_dataset" {
  description = "BigQuery dataset ID storing pricing reference tables, historical backfill, and analytical views."
  type        = string
  default     = "antigravity_monitoring"
}

variable "raw_logs_dataset" {
  description = "BigQuery dataset ID receiving live Cloud Logging exports from the Antigravity sink."
  type        = string
  default     = "antigravity_raw_logs"
}

variable "sink_name" {
  description = "Name of the Cloud Logging -> BigQuery sink."
  type        = string
  default     = "antigravity-org-bq-sink"
}

variable "billing_export_table" {
  description = "Optional BigQuery Standard Cloud Billing Export table FQN (project.dataset.gcp_billing_export_v1_XXXXXX) for FinOps SKU reconciliation."
  type        = string
  default     = ""
}

variable "allow_public_access" {
  description = "Set true to grant allUsers roles/run.invoker (public access). Keep false (default) when protecting behind Identity-Aware Proxy (IAP) or IAM."
  type        = bool
  default     = false
}

variable "grant_org_sync_roles" {
  description = "When true and org_id is set, grants the dashboard runtime service account roles/logging.viewer and roles/browser on the Organization so live 'Sync Data' discovers all child projects automatically."
  type        = bool
  default     = false
}

variable "max_instances" {
  description = "Maximum Cloud Run container instances (cost & DDoS ceiling)."
  type        = number
  default     = 5
}

variable "deletion_protection" {
  description = "Enable Terraform deletion protection on BigQuery tables."
  type        = bool
  default     = true
}

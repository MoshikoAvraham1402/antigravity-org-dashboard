output "dashboard_url" {
  description = "HTTPS URL of the deployed Antigravity Organization Dashboard on Cloud Run."
  value       = google_cloud_run_v2_service.dashboard.uri
}

output "runtime_service_account" {
  description = "Dedicated least-privilege Service Account running the Cloud Run service."
  value       = google_service_account.dashboard_runtime.email
}

output "logging_sink_writer_identity" {
  description = "Cloud Logging sink writer identity granted WRITER access on the raw logs BigQuery dataset."
  value       = local.sink_writer_identity
}

output "bigquery_monitoring_dataset" {
  description = "BigQuery dataset ID hosting reference tables and curated views."
  value       = "${var.project_id}.${google_bigquery_dataset.monitoring.dataset_id}"
}

output "bigquery_raw_logs_dataset" {
  description = "BigQuery dataset ID receiving live Cloud Logging exports."
  value       = "${var.project_id}.${google_bigquery_dataset.raw_logs.dataset_id}"
}

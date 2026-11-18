locals {
  required_apis = [
    "run.googleapis.com",
    "bigquery.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iap.googleapis.com",
  ]

  antigravity_log_filter = "resource.type=\"businessaicode.googleapis.com/BAICInstance\" AND (logName:\"inference_response\" OR logName:\"client_telemetry\")"
  sink_destination       = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${google_bigquery_dataset.raw_logs.dataset_id}"

  sink_writer_identity = (
    var.org_id != "" ? google_logging_organization_sink.org_sink[0].writer_identity :
    var.folder_id != "" ? google_logging_folder_sink.folder_sink[0].writer_identity :
    google_logging_project_sink.project_sink[0].writer_identity
  )

  common_labels = {
    datacloud = "antigravity"
    managed   = "terraform"
  }
}

data "google_project" "host" {
  project_id = var.project_id
}

resource "google_project_service" "apis" {
  for_each           = toset(local.required_apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ==============================================================================
# 1. BigQuery Datasets & Core Tables
# ==============================================================================
resource "google_bigquery_dataset" "raw_logs" {
  dataset_id  = var.raw_logs_dataset
  project     = var.project_id
  location    = var.bq_location
  description = "Cloud Logging sink destination for Antigravity InferenceResponseLog & ClientTelemetryLog"
  labels      = local.common_labels

  depends_on = [google_project_service.apis]
}

resource "google_bigquery_dataset" "monitoring" {
  dataset_id  = var.monitoring_dataset
  project     = var.project_id
  location    = var.bq_location
  description = "Curated Antigravity FinOps & usage intelligence tables and views"
  labels      = local.common_labels

  depends_on = [google_project_service.apis]
}

resource "google_bigquery_table" "historical_logs" {
  dataset_id          = google_bigquery_dataset.monitoring.dataset_id
  table_id            = "real_historical_inference_logs"
  project             = var.project_id
  deletion_protection = var.deletion_protection
  labels              = local.common_labels

  time_partitioning {
    type  = "DAY"
    field = "event_ts"
  }

  clustering = ["user_email", "model_id", "client_name"]

  schema = jsonencode([
    { name = "insert_id", type = "STRING", mode = "NULLABLE" },
    { name = "request_id", type = "STRING", mode = "NULLABLE" },
    { name = "event_ts", type = "TIMESTAMP", mode = "NULLABLE" },
    { name = "project_id", type = "STRING", mode = "NULLABLE" },
    { name = "resource_container", type = "STRING", mode = "NULLABLE" },
    { name = "user_email", type = "STRING", mode = "NULLABLE" },
    { name = "trajectory_id", type = "STRING", mode = "NULLABLE" },
    { name = "model_id", type = "STRING", mode = "NULLABLE" },
    { name = "model_provider", type = "STRING", mode = "NULLABLE" },
    { name = "client_name", type = "STRING", mode = "NULLABLE" },
    { name = "client_version", type = "STRING", mode = "NULLABLE" },
    { name = "experience", type = "STRING", mode = "NULLABLE" },
    { name = "quota_type", type = "STRING", mode = "NULLABLE" },
    { name = "prompt_tokens", type = "INT64", mode = "NULLABLE" },
    { name = "cached_tokens", type = "INT64", mode = "NULLABLE" },
    { name = "output_tokens", type = "INT64", mode = "NULLABLE" },
    { name = "thinking_tokens", type = "INT64", mode = "NULLABLE" },
    { name = "total_tokens", type = "INT64", mode = "NULLABLE" },
    { name = "tool_calls_count", type = "INT64", mode = "NULLABLE" },
    { name = "request_count", type = "INT64", mode = "NULLABLE" }
  ])
}

resource "google_bigquery_table" "pricing_rates" {
  dataset_id          = google_bigquery_dataset.monitoring.dataset_id
  table_id            = "model_pricing_rates"
  project             = var.project_id
  deletion_protection = false
  labels              = local.common_labels

  schema = jsonencode([
    { name = "model_id", type = "STRING", mode = "NULLABLE" },
    { name = "display_name", type = "STRING", mode = "NULLABLE" },
    { name = "provider", type = "STRING", mode = "NULLABLE" },
    { name = "input_usd_per_1m", type = "FLOAT64", mode = "NULLABLE" },
    { name = "cached_input_usd_per_1m", type = "FLOAT64", mode = "NULLABLE" },
    { name = "output_usd_per_1m", type = "FLOAT64", mode = "NULLABLE" },
    { name = "thinking_usd_per_1m", type = "FLOAT64", mode = "NULLABLE" }
  ])
}

resource "google_bigquery_table" "project_directory" {
  dataset_id          = google_bigquery_dataset.monitoring.dataset_id
  table_id            = "project_directory"
  project             = var.project_id
  deletion_protection = false
  labels              = local.common_labels

  schema = jsonencode([
    { name = "project_number", type = "STRING", mode = "NULLABLE" },
    { name = "project_id", type = "STRING", mode = "NULLABLE" }
  ])
}

# ==============================================================================
# 2. Cloud Logging -> BigQuery Sink (Org, Folder, or Project Scope)
# ==============================================================================
resource "google_logging_organization_sink" "org_sink" {
  count            = var.org_id != "" ? 1 : 0
  name             = var.sink_name
  org_id           = var.org_id
  destination      = local.sink_destination
  filter           = local.antigravity_log_filter
  include_children = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

resource "google_logging_folder_sink" "folder_sink" {
  count            = var.org_id == "" && var.folder_id != "" ? 1 : 0
  name             = var.sink_name
  folder           = var.folder_id
  destination      = local.sink_destination
  filter           = local.antigravity_log_filter
  include_children = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

resource "google_logging_project_sink" "project_sink" {
  count                  = var.org_id == "" && var.folder_id == "" ? 1 : 0
  name                   = var.sink_name
  project                = var.project_id
  destination            = local.sink_destination
  filter                 = local.antigravity_log_filter
  unique_writer_identity = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

resource "google_bigquery_dataset_iam_member" "sink_writer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.raw_logs.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = local.sink_writer_identity
}

# ==============================================================================
# 3. Dedicated Least-Privilege Runtime Service Account & Scoped IAM
# ==============================================================================
resource "google_service_account" "dashboard_runtime" {
  account_id   = "antigravity-dashboard-sa"
  display_name = "Antigravity Dashboard Least-Privilege Runtime SA"
  description  = "Read-only BigQuery query execution & metadata-only Cloud Logging sync for Antigravity Dashboard"
  project      = var.project_id

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

resource "google_project_iam_member" "host_logging_viewer" {
  project = var.project_id
  role    = "roles/logging.viewer"
  member  = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

resource "google_project_iam_member" "host_monitoring_viewer" {
  count   = var.enable_vertex_telemetry ? 1 : 0
  project = var.project_id
  role    = "roles/monitoring.viewer"
  member  = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

resource "google_bigquery_dataset_iam_member" "raw_logs_reader" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.raw_logs.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

resource "google_bigquery_dataset_iam_member" "monitoring_reader" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.monitoring.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

resource "google_bigquery_table_iam_member" "historical_sync_writer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.monitoring.dataset_id
  table_id   = google_bigquery_table.historical_logs.table_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

resource "google_organization_iam_member" "org_logging_viewer" {
  count  = var.grant_org_sync_roles && var.org_id != "" ? 1 : 0
  org_id = var.org_id
  role   = "roles/logging.viewer"
  member = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

resource "google_organization_iam_member" "org_browser" {
  count  = var.grant_org_sync_roles && var.org_id != "" ? 1 : 0
  org_id = var.org_id
  role   = "roles/browser"
  member = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "auth_token_accessor" {
  count     = var.auth_token_secret_name != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.auth_token_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.dashboard_runtime.email}"
}

# ==============================================================================
# 4. Hardened Cloud Run v2 Service
# ==============================================================================
resource "google_cloud_run_v2_service" "dashboard" {
  name                = var.service_name
  location            = var.region
  project             = var.project_id
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false
  labels              = local.common_labels

  scaling {
    max_instance_count = var.max_instances
  }

  template {
    service_account                  = google_service_account.dashboard_runtime.email
    max_instance_request_concurrency = 40

    containers {
      image = var.container_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_PROJECT_NUMBER"
        value = data.google_project.host.number
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "GCP_ORG_ID"
        value = var.org_id
      }
      env {
        name  = "GCP_ORG_DOMAIN"
        value = var.org_domain
      }
      env {
        name  = "ORG_TIMEZONE"
        value = var.org_timezone
      }
      env {
        name  = "MONITORING_DATASET"
        value = google_bigquery_dataset.monitoring.dataset_id
      }
      env {
        name  = "RAW_LOGS_DATASET"
        value = google_bigquery_dataset.raw_logs.dataset_id
      }
      env {
        name  = "LOGGING_SINK_NAME"
        value = var.sink_name
      }
      env {
        name  = "BILLING_EXPORT_TABLE"
        value = var.billing_export_table
      }
      env {
        name  = "REQUIRE_IAP_AUTH"
        value = var.allow_public_access ? "false" : "true"
      }
      env {
        name  = "ENABLE_VERTEX_TELEMETRY"
        value = var.enable_vertex_telemetry ? "true" : "false"
      }

      dynamic "env" {
        for_each = var.auth_token_secret_name != "" ? [1] : []
        content {
          name = "DASHBOARD_AUTH_TOKEN"
          value_source {
            secret_key_ref {
              secret  = var.auth_token_secret_name
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.bq_job_user,
    google_bigquery_dataset_iam_member.monitoring_reader,
    google_bigquery_dataset_iam_member.raw_logs_reader,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = var.allow_public_access ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.dashboard.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

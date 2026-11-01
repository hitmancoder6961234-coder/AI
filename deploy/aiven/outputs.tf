output "service_uri" {
  description = "PostgreSQL connection URI for the app user → set as AIVEN_PG_URI"
  sensitive   = true
  value       = "postgres://${aiven_pg_user.app.username}:${aiven_pg_user.app.password}@${aiven_pg.darkness.service_host}:${aiven_pg.darkness.service_port}/${aiven_pg_database.darkness.database_name}?sslmode=require"
}

output "host" {
  value = aiven_pg.darkness.service_host
}

output "port" {
  value = aiven_pg.darkness.service_port
}

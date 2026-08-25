terraform {
  required_version = ">= 1.5.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {}

resource "cloudflare_dns_record" "vercel_apex" {
  zone_id = var.zone_id
  name    = var.zone_name
  content = var.vercel_apex_content
  type    = var.vercel_apex_record_type
  ttl     = 300
  proxied = false
  comment = "Vercel frontend apex; intentionally DNS-only"
}

resource "cloudflare_zone_setting" "tls_1_3" {
  zone_id    = var.zone_id
  setting_id = "tls_1_3"
  value      = "on"
}

resource "cloudflare_zone_setting" "http3" {
  zone_id    = var.zone_id
  setting_id = "http3"
  value      = "on"
}

resource "cloudflare_ruleset" "gateway_cache" {
  zone_id     = var.zone_id
  name        = "Cheatcode gateway cache policy"
  description = "Never share-cache authenticated, signed, streamed, or user-scoped gateway traffic"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules = [
    {
      ref         = "cheatcode_gateway_cache_bypass"
      description = "Bypass cache for the complete authenticated gateway"
      expression  = "http.host eq \"${var.gateway_hostname}\""
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
    }
  ]
}

resource "cloudflare_ruleset" "gateway_compression" {
  zone_id     = var.zone_id
  name        = "Cheatcode gateway compression policy"
  description = "Prefer modern compression for bounded responses and disable transforms on run streams"
  kind        = "zone"
  phase       = "http_response_compression"

  rules = [
    {
      ref         = "cheatcode_gateway_modern_compression"
      description = "Prefer Zstandard with Brotli/Gzip/automatic fallback"
      expression  = "http.host eq \"${var.gateway_hostname}\""
      action      = "compress_response"
      action_parameters = {
        algorithms = [
          { name = "zstd" },
          { name = "brotli" },
          { name = "gzip" },
          { name = "auto" }
        ]
      }
    },
    {
      ref         = "cheatcode_agent_stream_no_compression"
      description = "Prevent compressor buffering on create and reconnect run streams"
      expression  = "(http.host eq \"${var.gateway_hostname}\" and starts_with(http.request.uri.path, \"/v1/threads/\") and ((http.request.method eq \"POST\" and ends_with(http.request.uri.path, \"/runs\")) or (http.request.method eq \"GET\" and ends_with(http.request.uri.path, \"/runs/stream\"))))"
      action      = "compress_response"
      action_parameters = {
        algorithms = [{ name = "none" }]
      }
    }
  ]
}

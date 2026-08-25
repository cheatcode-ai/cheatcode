variable "zone_id" {
  description = "Cloudflare zone identifier for trycheatcode.com"
  type        = string
}

variable "zone_name" {
  description = "Canonical frontend apex"
  type        = string
  default     = "trycheatcode.com"
}

variable "gateway_hostname" {
  description = "Orange-clouded Worker gateway hostname"
  type        = string
  default     = "gateway.trycheatcode.com"
}

variable "vercel_apex_record_type" {
  description = "Current Vercel-prescribed apex record type"
  type        = string

  validation {
    condition     = contains(["A", "AAAA", "CNAME"], var.vercel_apex_record_type)
    error_message = "vercel_apex_record_type must be A, AAAA, or CNAME."
  }
}

variable "vercel_apex_content" {
  description = "Current Vercel-prescribed apex record content; verify in Vercel before every change"
  type        = string
}

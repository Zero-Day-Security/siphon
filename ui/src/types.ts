export interface Flow {
  id: string
  timestamp: number
  method: string
  url: string
  host: string
  port: number
  path: string
  scheme: string
  request_headers: Record<string, string>
  request_body: string | null
  request_content_type: string | null
  status_code: number | null
  response_headers: Record<string, string> | null
  response_body: string | null
  response_content_type: string | null
  duration_ms: number | null
  highlighted: boolean
  notes: string
  tags: string[]
}

export interface Evidence {
  id: string
  flow_id: string
  timestamp: number
  url: string
  method: string
  status_code: number | null
  notes: string
  request_headers: Record<string, string>
  request_body: string | null
  response_headers: Record<string, string> | null
  response_body: string | null
}

export interface BeaconToken {
  id: string
  token: string
  description: string
  created_at: number
  payload_url: string
  interaction_count: number
}

export interface BeaconInteraction {
  id: string
  token: string
  timestamp: number
  source_ip: string
  method: string
  path: string
  headers: Record<string, string>
  body: string
  query_string: string
  protocol: string
}

export interface RepeaterRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

export interface RepeaterTab {
  id: string
  name: string
  request: RepeaterRequest
  response: Flow | null
  loading: boolean
}

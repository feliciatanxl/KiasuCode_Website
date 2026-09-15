export interface UserTableSchema {
  id: string
  provider: 'google' | 'telegram' | 'local'
  provider_id: string
  email: string | null
  password_hash?: string | null
  name: string
  photo_url: string | null
  public_key?: string | null
  wrapped_private_key?: string | null
  has_consented: boolean
  telegram_chat_id?: string | null
  google_id?: string | null
  session_version: number
  spotify_access_token?: string | null
  spotify_refresh_token?: string | null
  spotify_token_expiry?: number | null
  created_at: string
  updated_at: string
}

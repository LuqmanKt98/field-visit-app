export enum TaskStatus {
    NotStarted = 0,
    InProgress = 1,
    Completed = 2,
}

export interface TaskFieldRow {
    task_id: string;
    task_status: TaskStatus;
    job_id: string | null;
    vendor_task_id: string | null;
    prop_id: string | null;
    prop_mgr_id: string | null;
    prop_mgr_fn: string | null;
    prop_mgr_ln: string | null;
    prop_mgr_phone: string | null;
    agent_id: string | null;
    agent_fm: string | null;
    agent_lm: string | null;
    prop_full_addr: string | null;
    prop_st_addr: string | null;
    prop_addr_l1: string | null;
    prop_addr_l2: string | null;
    prop_number: string | null;
    prop_city: string | null;
    prop_pin_cd: string | null;
    prop_district: string | null;
    g_place_id: string | null;
    g_address: string | null;
    g_location: string | null;
    g_latitude: string | null;
    g_longitude: string | null;
    g_loc_type: string | null;
    g_types: string | null;
    g_street_number: string | null;
    g_route: string | null;
    g_route_sh: string | null;
    g_locality: string | null;
    g_sublocality_level_1: string | null;
    g_sublocality_level_2: string | null;
    // NB: the client's spreadsheet spells these G_ADMINSTRATIVE_* (missing the second
    // "i"); the migration uses the correct spelling. See README.
    g_administrative_area_level_1: string | null;
    g_administrative_area_level_2: string | null;
    g_administrative_area_level_3: string | null;
    g_administrative_area_level_1_sh: string | null;
    g_administrative_area_level_2_sh: string | null;
    g_administrative_area_level_3_sh: string | null;
    g_country: string | null;
    g_country_sh: string | null;
    g_postal_code: string | null;
    g_postal_code_suffix: string | null;
    g_bounds: string | null;
    g_viewport: string | null;
    web_url: string | null;
    folder_url: string | null;
    cloud_url: string | null;
    created_by: string | null;
    created_timestamp: Date | null;
    updated_by: string | null;
    updated_timestamp: Date | null;
    add_info1: string | null;
    add_info2: string | null;
    add_info3: string | null;
}

export type MediaType = 'photo' | 'video';

export interface TaskMediaRow {
    id: string;
    task_id: string;
    media_type: MediaType;
    sequence_number: number;
    s3_bucket: string;
    s3_key: string;
    s3_url: string;
    direction_degrees: string | null;
    direction_cardinal: string | null;
    captured_latitude: string | null;
    captured_longitude: string | null;
    captured_at: Date;
    file_size_bytes: string | null;
    created_timestamp: Date;
}

export interface AdminUserRow {
    id: string;
    username: string;
    email: string;
    password_hash: string;
    must_change_password: boolean;
    password_changed_at: Date | null;
    created_timestamp: Date;
}

export interface AuthenticatedRequestUser {
    adminId: string;
    username: string;
}

-- ============================================
-- APEX P1 ELIGIBILITY CALCULATOR
-- Supabase Database Schema
-- Version: 1.0
-- Date: January 26, 2026
-- Region: ap-southeast-2 (Sydney, Australia)
-- ============================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- CUSTOM TYPES
-- ============================================

CREATE TYPE pathway_type AS ENUM ('P1_RED', 'P2_GREEN');
CREATE TYPE eligibility_status AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'PENDING_HOURS', 'PENDING_TENURE', 'PENDING_ASSESSMENTS');
CREATE TYPE user_role AS ENUM ('student', 'instructor', 'admin');
CREATE TYPE consent_method AS ENUM ('digital', 'physical', 'both');
CREATE TYPE audit_action AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'CONSENT', 'ACCESS_REQUEST');

-- ============================================
-- USERS TABLE (synced with Clerk)
-- ============================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clerk_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    instructor_name TEXT NOT NULL,
    phone TEXT,
    adi_number TEXT,
    role user_role DEFAULT 'instructor',
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_verified_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    login_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_clerk_id ON users(clerk_user_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- STUDENTS TABLE
-- ============================================

CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Personal Information (encrypted at rest by Supabase)
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    email TEXT,
    phone TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    suburb TEXT,
    state TEXT DEFAULT 'ACT',
    postcode TEXT,
    
    -- Licence Information
    licence_number TEXT,
    licence_expiry_date DATE,
    licence_issue_date DATE,
    age_at_issue INTEGER,
    pathway pathway_type,
    
    -- Driving Hours
    supervised_hours DECIMAL(6,2) DEFAULT 0,
    professional_hours DECIMAL(6,2) DEFAULT 0,
    night_hours DECIMAL(6,2) DEFAULT 0,
    
    -- Credits
    safer_driver_credit BOOLEAN DEFAULT FALSE,
    vru_credit BOOLEAN DEFAULT FALSE,
    first_aid_credit BOOLEAN DEFAULT FALSE,
    
    -- Calculated totals
    total_hours DECIMAL(6,2) DEFAULT 0,
    hours_required INTEGER DEFAULT 100,
    hours_remaining DECIMAL(6,2) DEFAULT 100,
    
    -- Assessments
    hpt_completed BOOLEAN DEFAULT FALSE,
    hpt_date DATE,
    cbta_completed BOOLEAN DEFAULT FALSE,
    cbta_date DATE,
    assessment_1_22_completed BOOLEAN DEFAULT FALSE,
    assessment_1_22_date DATE,
    
    -- Eligibility
    tenure_start_date DATE,
    tenure_months_required INTEGER DEFAULT 12,
    earliest_eligible_date DATE,
    eligibility_status eligibility_status DEFAULT 'NOT_ELIGIBLE',
    eligibility_notes TEXT,
    
    -- Final Drive
    final_drive_scheduled BOOLEAN DEFAULT FALSE,
    final_drive_date DATE,
    final_drive_time TIME,
    final_drive_location TEXT,
    final_drive_passed BOOLEAN,
    final_drive_completed_at TIMESTAMPTZ,
    
    -- Consent & Compliance (Australian Privacy Act)
    consent_given BOOLEAN DEFAULT FALSE,
    consent_method consent_method,
    consent_timestamp TIMESTAMPTZ,
    consent_ip_address INET,
    consent_user_agent TEXT,
    consent_parent_guardian TEXT,
    privacy_policy_version TEXT DEFAULT '1.0',
    data_collection_purpose TEXT DEFAULT 'Managing driving lesson records and P1 licence eligibility tracking',
    
    -- Data Retention
    data_retention_until DATE,
    marked_for_deletion BOOLEAN DEFAULT FALSE,
    deletion_requested_at TIMESTAMPTZ,
    deletion_requested_by TEXT,
    
    -- OCR Data
    ocr_raw_data JSONB,
    ocr_confidence DECIMAL(5,2),
    
    -- Metadata
    notes TEXT,
    is_archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_students_name ON students(last_name, first_name);
CREATE INDEX idx_students_licence ON students(licence_number);
CREATE INDEX idx_students_eligibility ON students(eligibility_status);
CREATE INDEX idx_students_created ON students(created_at DESC);
CREATE INDEX idx_students_consent ON students(consent_given);

-- ============================================
-- CBT&A DOCUMENTS TABLE
-- ============================================

CREATE TABLE cbta_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    ocr_extracted_data JSONB,
    ocr_confidence DECIMAL(5,2),
    ocr_processed_at TIMESTAMPTZ,
    keep_original BOOLEAN DEFAULT TRUE,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by UUID REFERENCES users(id)
);

CREATE INDEX idx_cbta_student ON cbta_documents(student_id);
CREATE INDEX idx_cbta_user ON cbta_documents(user_id);

-- ============================================
-- AUDIT LOG TABLE (Privacy Act Compliance)
-- ============================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    clerk_user_id TEXT,
    user_email TEXT,
    action audit_action NOT NULL,
    table_name TEXT,
    record_id UUID,
    student_name TEXT,
    old_values JSONB,
    new_values JSONB,
    changes_summary TEXT,
    ip_address INET,
    user_agent TEXT,
    session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_table ON audit_log(table_name);
CREATE INDEX idx_audit_record ON audit_log(record_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ============================================
-- DATA ACCESS REQUESTS (Privacy Act APP 12)
-- ============================================

CREATE TABLE data_access_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id),
    requestor_name TEXT NOT NULL,
    requestor_email TEXT NOT NULL,
    requestor_phone TEXT,
    request_type TEXT NOT NULL CHECK (request_type IN ('access', 'correction', 'deletion')),
    request_details TEXT,
    identity_verified BOOLEAN DEFAULT FALSE,
    identity_verification_method TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'approved', 'denied', 'completed')),
    handled_by UUID REFERENCES users(id),
    handled_at TIMESTAMPTZ,
    response_notes TEXT,
    response_sent_at TIMESTAMPTZ,
    due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dar_status ON data_access_requests(status);
CREATE INDEX idx_dar_student ON data_access_requests(student_id);
CREATE INDEX idx_dar_due ON data_access_requests(due_date);

-- ============================================
-- BREACH LOG (Notifiable Data Breaches scheme)
-- ============================================

CREATE TABLE breach_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    detected_by UUID REFERENCES users(id),
    breach_type TEXT NOT NULL,
    description TEXT NOT NULL,
    affected_records INTEGER,
    affected_student_ids UUID[],
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    likely_harm BOOLEAN DEFAULT FALSE,
    notified_oaic BOOLEAN DEFAULT FALSE,
    oaic_notification_date DATE,
    oaic_reference TEXT,
    notified_individuals BOOLEAN DEFAULT FALSE,
    notification_date DATE,
    remediation_steps TEXT,
    remediation_completed BOOLEAN DEFAULT FALSE,
    remediation_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_breach_severity ON breach_log(severity);
CREATE INDEX idx_breach_notified ON breach_log(notified_oaic);

-- ============================================
-- CONSENT LOG (Detailed consent tracking)
-- ============================================

CREATE TABLE consent_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL,
    consent_given BOOLEAN NOT NULL,
    consent_text TEXT,
    privacy_policy_version TEXT,
    ip_address INET,
    user_agent TEXT,
    parent_guardian_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_student ON consent_log(student_id);

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbta_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE breach_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can update own profile" ON users
    FOR UPDATE USING (clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Admins can view all users" ON users
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub' 
            AND u.role = 'admin'
        )
    );

-- Students policies
CREATE POLICY "Instructors can view own students" ON students
    FOR SELECT USING (
        user_id IN (
            SELECT id FROM users 
            WHERE clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

CREATE POLICY "Admins can view all students" ON students
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub' 
            AND u.role = 'admin'
        )
    );

CREATE POLICY "Instructors can insert own students" ON students
    FOR INSERT WITH CHECK (
        user_id IN (
            SELECT id FROM users 
            WHERE clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

CREATE POLICY "Instructors can update own students" ON students
    FOR UPDATE USING (
        user_id IN (
            SELECT id FROM users 
            WHERE clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

CREATE POLICY "Admins can update all students" ON students
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub' 
            AND u.role = 'admin'
        )
    );

CREATE POLICY "Instructors can delete own students" ON students
    FOR DELETE USING (
        user_id IN (
            SELECT id FROM users 
            WHERE clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

CREATE POLICY "Admins can delete any student" ON students
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub' 
            AND u.role = 'admin'
        )
    );

-- CBT&A Documents policies
CREATE POLICY "Users can view own documents" ON cbta_documents
    FOR SELECT USING (
        user_id IN (
            SELECT id FROM users 
            WHERE clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

CREATE POLICY "Users can insert own documents" ON cbta_documents
    FOR INSERT WITH CHECK (
        user_id IN (
            SELECT id FROM users 
            WHERE clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

CREATE POLICY "Users can delete own documents" ON cbta_documents
    FOR DELETE USING (
        user_id IN (
            SELECT id FROM users 
            WHERE clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

-- Audit log policies
CREATE POLICY "Users can view own audit logs" ON audit_log
    FOR SELECT USING (
        user_id IN (
            SELECT id FROM users 
            WHERE clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

CREATE POLICY "Admins can view all audit logs" ON audit_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub' 
            AND u.role = 'admin'
        )
    );

CREATE POLICY "System can insert audit logs" ON audit_log
    FOR INSERT WITH CHECK (true);

-- Data access requests - Admins only
CREATE POLICY "Admins can manage access requests" ON data_access_requests
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub' 
            AND u.role = 'admin'
        )
    );

-- Breach log - Admins only
CREATE POLICY "Admins can manage breach logs" ON breach_log
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub' 
            AND u.role = 'admin'
        )
    );

-- Consent log
CREATE POLICY "Users can view consent for own students" ON consent_log
    FOR SELECT USING (
        student_id IN (
            SELECT s.id FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

CREATE POLICY "Users can insert consent for own students" ON consent_log
    FOR INSERT WITH CHECK (
        student_id IN (
            SELECT s.id FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE u.clerk_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
        )
    );

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to calculate student eligibility
CREATE OR REPLACE FUNCTION calculate_eligibility()
RETURNS TRIGGER AS $$
DECLARE
    v_age_at_issue INTEGER;
    v_is_under_25 BOOLEAN;
    v_hours_req INTEGER;
    v_night_req INTEGER;
    v_tenure_req INTEGER;
    v_total_hrs DECIMAL;
    v_prof_credit DECIMAL;
    v_issue_date DATE;
BEGIN
    -- Calculate issue date from expiry (5-year licence in ACT)
    IF NEW.licence_expiry_date IS NOT NULL THEN
        v_issue_date := NEW.licence_expiry_date - INTERVAL '5 years';
        NEW.licence_issue_date := v_issue_date;
    END IF;
    
    -- Calculate age at issue
    IF NEW.date_of_birth IS NOT NULL AND NEW.licence_issue_date IS NOT NULL THEN
        v_age_at_issue := EXTRACT(YEAR FROM AGE(NEW.licence_issue_date, NEW.date_of_birth));
        NEW.age_at_issue := v_age_at_issue;
        
        v_is_under_25 := v_age_at_issue < 25;
        NEW.pathway := CASE WHEN v_is_under_25 THEN 'P1_RED' ELSE 'P2_GREEN' END;
        
        v_hours_req := CASE WHEN v_is_under_25 THEN 100 ELSE 50 END;
        v_night_req := CASE WHEN v_is_under_25 THEN 10 ELSE 5 END;
        v_tenure_req := CASE WHEN v_is_under_25 THEN 12 ELSE 6 END;
        
        NEW.hours_required := v_hours_req;
        NEW.tenure_months_required := v_tenure_req;
    END IF;
    
    -- Calculate total hours
    v_prof_credit := LEAST(COALESCE(NEW.professional_hours, 0), 10) * 3;
    v_total_hrs := v_prof_credit +
                 COALESCE(NEW.supervised_hours, 0) +
                 CASE WHEN NEW.safer_driver_credit THEN 20 ELSE 0 END +
                 CASE WHEN NEW.vru_credit THEN 10 ELSE 0 END +
                 CASE WHEN NEW.first_aid_credit THEN 5 ELSE 0 END;
    
    NEW.total_hours := v_total_hrs;
    NEW.hours_remaining := GREATEST(COALESCE(NEW.hours_required, 100) - v_total_hrs, 0);
    
    -- Calculate earliest eligible date
    IF NEW.tenure_start_date IS NOT NULL THEN
        NEW.earliest_eligible_date := NEW.tenure_start_date + 
            (COALESCE(NEW.tenure_months_required, 12) || ' months')::INTERVAL;
    END IF;
    
    -- Set default night requirement
    IF v_night_req IS NULL THEN v_night_req := 10; END IF;
    
    -- Determine eligibility status
    IF v_total_hrs >= COALESCE(NEW.hours_required, 100) 
       AND COALESCE(NEW.night_hours, 0) >= v_night_req
       AND NEW.cbta_completed = TRUE 
       AND NEW.assessment_1_22_completed = TRUE
       AND (NEW.earliest_eligible_date IS NULL OR CURRENT_DATE >= NEW.earliest_eligible_date)
       AND COALESCE(NEW.age_at_issue, 0) >= 17 THEN
        NEW.eligibility_status := 'ELIGIBLE';
    ELSIF v_total_hrs < COALESCE(NEW.hours_required, 100) THEN
        NEW.eligibility_status := 'PENDING_HOURS';
    ELSIF NEW.earliest_eligible_date IS NOT NULL AND CURRENT_DATE < NEW.earliest_eligible_date THEN
        NEW.eligibility_status := 'PENDING_TENURE';
    ELSIF NEW.cbta_completed = FALSE OR NEW.assessment_1_22_completed = FALSE THEN
        NEW.eligibility_status := 'PENDING_ASSESSMENTS';
    ELSE
        NEW.eligibility_status := 'NOT_ELIGIBLE';
    END IF;
    
    -- Set data retention date (5 years after final drive or creation)
    IF NEW.final_drive_completed_at IS NOT NULL THEN
        NEW.data_retention_until := (NEW.final_drive_completed_at + INTERVAL '5 years')::DATE;
    ELSIF NEW.data_retention_until IS NULL THEN
        NEW.data_retention_until := (CURRENT_DATE + INTERVAL '5 years')::DATE;
    END IF;
    
    NEW.updated_at := NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calculate_eligibility
    BEFORE INSERT OR UPDATE ON students
    FOR EACH ROW
    EXECUTE FUNCTION calculate_eligibility();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- VIEWS
-- ============================================

CREATE OR REPLACE VIEW student_summary AS
SELECT 
    s.id,
    s.user_id,
    s.first_name,
    s.last_name,
    s.first_name || ' ' || s.last_name AS full_name,
    s.licence_number,
    s.date_of_birth,
    s.pathway,
    s.total_hours,
    s.hours_required,
    s.hours_remaining,
    s.night_hours,
    s.eligibility_status,
    s.earliest_eligible_date,
    s.cbta_completed,
    s.assessment_1_22_completed,
    s.final_drive_scheduled,
    s.final_drive_date,
    s.consent_given,
    s.created_at,
    u.instructor_name
FROM students s
JOIN users u ON s.user_id = u.id
WHERE s.is_archived = FALSE;

-- ============================================
-- END OF SCHEMA
-- ============================================

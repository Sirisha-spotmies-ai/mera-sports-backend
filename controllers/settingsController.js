import { supabaseAdmin } from "../config/supabaseClient.js";
import { cacheDel } from "../config/redisClient.js";

export const getSettings = async (req, res) => {
    try {
        const { data: settings, error } = await supabaseAdmin.from("platform_settings").select("*").eq("id", 1).single();
        if (error) throw error;
        res.json({ success: true, settings });
    } catch (err) {
        if (err.code === 'PGRST116') {
            return res.json({ success: true, settings: { id: 1, platform_name: 'Default', logo_url: '' } });
        }
        console.error("GET SETTINGS ERROR:", err);
        res.status(500).json({ message: "Failed to fetch settings" });
    }
};

// Editable site content shown on the player app (footer, Contact pages).
// body key -> column. Only keys present in the body are written, so the
// Players page (which posts registrationConfig alone) never blanks these.
const TEXT_FIELDS = {
    address: "address",
    footerTagline: "footer_tagline",
};
const URL_FIELDS = {
    mapUrl: "map_url",
    instagramUrl: "instagram_url",
    facebookUrl: "facebook_url",
    youtubeUrl: "youtube_url",
    xUrl: "x_url",
};
const MAX_TEXT = 500;

export const updateSettings = async (req, res) => {
    try {
        const { platformName, supportEmail, supportPhone, logoUrl, logoSize } = req.body;
        const row = {
            id: 1,
            platform_name: platformName,
            support_email: supportEmail,
            support_phone: supportPhone,
            logo_url: logoUrl,
            logo_size: logoSize,
            registration_config: req.body.registrationConfig,
            updated_at: new Date()
        };

        for (const [key, column] of Object.entries(TEXT_FIELDS)) {
            if (req.body[key] === undefined) continue;
            const value = String(req.body[key] ?? "").trim();
            if (value.length > MAX_TEXT) {
                return res.status(400).json({ success: false, message: `${key} is too long (max ${MAX_TEXT} characters)` });
            }
            row[column] = value;
        }
        for (const [key, column] of Object.entries(URL_FIELDS)) {
            if (req.body[key] === undefined) continue;
            const value = String(req.body[key] ?? "").trim();
            // These become hrefs on the public site — only real web links, never
            // javascript:/data: URLs.
            if (value && (!/^https?:\/\/[^\s]+$/i.test(value) || value.length > MAX_TEXT)) {
                return res.status(400).json({ success: false, message: `${key} must be a valid http(s) link` });
            }
            row[column] = value;
        }

        // WhatsApp can differ from the support phone. Stored as a bare 10-digit
        // number like support_phone; empty means "use the support phone".
        if (req.body.whatsappNumber !== undefined) {
            const digits = String(req.body.whatsappNumber ?? "").replace(/\D/g, "");
            if (digits && digits.length !== 10) {
                return res.status(400).json({ success: false, message: "WhatsApp number must be a 10-digit number" });
            }
            row.whatsapp_number = digits;
        }

        const { data: settings, error } = await supabaseAdmin
            .from("platform_settings")
            .upsert(row)
            .select()
            .single();

        if (error) {
            // Column missing = the platform_settings migration has not run yet.
            if (error.code === "PGRST204" || error.code === "42703") {
                return res.status(500).json({ success: false, message: "Database is missing the new settings columns — run the platform settings migration first." });
            }
            throw error;
        }
        await cacheDel("public:settings"); // refresh public footer/logo cache
        res.json({ success: true, settings });
    } catch (err) {
        console.error("UPDATE SETTINGS ERROR:", err);
        res.status(500).json({ message: "Failed to update settings" });
    }
};

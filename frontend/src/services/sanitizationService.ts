import DOMPurify from 'dompurify';

class SanitizationService {
    /**
     * Sanitize a string to prevent XSS
     */
    sanitize(input: string): string {
        return DOMPurify.sanitize(input);
    }

    /**
     * Sanitize a filename to remove dangerous characters and limit length
     */
    sanitizeFileName(fileName: string): string {
        // Remove null bytes and control characters
        // eslint-disable-next-line no-control-regex -- Intentionally strip C0 and C1 control characters.
        let sanitized = fileName.replace(/[\x00-\x1f\x80-\x9f]/g, "");

        // Remove potentially dangerous characters for file systems (though we store in DB)
        // Keep alphanumeric, dots, dashes, underscores, spaces, and common brackets
        sanitized = sanitized.replace(/[^a-zA-Z0-9.\-_ ()[\]]/g, "_");

        // Prevent directory traversal
        sanitized = sanitized.replace(/\.\./g, "");

        // Limit length
        if (sanitized.length > 255) {
            const extIndex = sanitized.lastIndexOf('.');
            if (extIndex !== -1) {
                const ext = sanitized.substring(extIndex);
                sanitized = sanitized.substring(0, 255 - ext.length) + ext;
            } else {
                sanitized = sanitized.substring(0, 255);
            }
        }

        return sanitized;
    }

    /**
     * Validate email format
     */
    isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}

export const sanitizationService = new SanitizationService();

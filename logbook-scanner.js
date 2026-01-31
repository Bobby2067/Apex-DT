/**
 * APEX Logbook Scanner Module
 * Version: 1.0.0
 * 
 * Standalone module for scanning ACT learner logbook pages,
 * extracting driving hours, and validating entries.
 * 
 * Usage:
 *   const scanner = new LogbookScanner({ apiKey: 'your-claude-api-key' });
 *   const result = await scanner.scanPage(imageFile);
 *   console.log(result.entries, result.errors, result.totals);
 */

class LogbookScanner {
    constructor(options = {}) {
        this.apiKey = options.apiKey || null;
        this.apiEndpoint = options.apiEndpoint || 'https://api.anthropic.com/v1/messages';
        this.model = options.model || 'claude-sonnet-4-20250514';
        this.onProgress = options.onProgress || (() => {});
        this.onError = options.onError || console.error;
        
        // Page type configurations
        this.pageTypes = {
            BLUE_DAY: {
                name: 'Supervised Day',
                color: '#3b82f6',
                creditMultiplier: 1,
                headerColor: 'blue/navy',
                columns: ['DATE', 'WEATHER CONDITIONS', 'SD NAME', 'SD LICENCE', 'SD SIGNATURE', 'START TIME', 'FINISH TIME', 'ODOMETER START', 'ODOMETER FINISH', 'TOTAL TIME']
            },
            RED_NIGHT: {
                name: 'Supervised Night',
                color: '#ef4444',
                creditMultiplier: 1,
                headerColor: 'red',
                columns: ['DATE', 'WEATHER CONDITIONS', 'SD NAME', 'SD LICENCE', 'SD SIGNATURE', 'START TIME', 'FINISH TIME', 'ODOMETER START', 'ODOMETER FINISH', 'TOTAL TIME']
            },
            GREEN_ADI: {
                name: 'ADI Professional',
                color: '#22c55e',
                creditMultiplier: 3, // First 10 hours
                headerColor: 'green',
                columns: ['DATE', 'WEATHER CONDITIONS', 'ADI NUMBER', 'ADI SIGNATURE', 'START TIME', 'FINISH TIME', 'ODOMETER START', 'ODOMETER FINISH', 'TOTAL TIME']
            },
            ADI_STAMP: {
                name: 'ADI Stamp Page',
                color: '#22c55e',
                creditMultiplier: 3,
                headerColor: 'grey/white',
                columns: ['DATE', 'ADI', 'HOURS SPENT DRIVING', 'STAMP']
            }
        };

        // Validation rules
        this.validationRules = {
            maxSessionHours: 2, // Max 2 hours before 30min break required
            minSessionMinutes: 5, // Minimum valid session
            maxDailyHours: 8, // Reasonable daily maximum
            earliestDate: new Date('2020-01-01'), // Reasonable earliest date
        };
    }

    /**
     * Scan a logbook page image and extract entries
     * @param {File|Blob|string} image - Image file, blob, or base64 string
     * @returns {Promise<ScanResult>}
     */
    async scanPage(image) {
        this.onProgress({ stage: 'preparing', message: 'Preparing image...' });
        
        try {
            // Convert image to base64 if needed
            const base64Image = await this.imageToBase64(image);
            
            this.onProgress({ stage: 'detecting', message: 'Detecting page type...' });
            
            // Send to Claude API for extraction
            const extractionResult = await this.extractWithClaude(base64Image);
            
            this.onProgress({ stage: 'validating', message: 'Validating entries...' });
            
            // Validate all entries
            const validatedResult = this.validateEntries(extractionResult);
            
            this.onProgress({ stage: 'complete', message: 'Scan complete!' });
            
            return validatedResult;
            
        } catch (error) {
            this.onError(error);
            throw error;
        }
    }

    /**
     * Convert various image formats to base64
     */
    async imageToBase64(image) {
        if (typeof image === 'string') {
            // Already base64 or URL
            if (image.startsWith('data:')) {
                return image.split(',')[1];
            }
            return image;
        }
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(image);
        });
    }

    /**
     * Extract data using Claude Vision API
     */
    async extractWithClaude(base64Image) {
        const prompt = `You are analyzing an ACT (Australian Capital Territory) learner driver logbook page. 

IMPORTANT: Extract ALL handwritten entries from this logbook page with extreme accuracy.

First, identify the page type by the header color:
- BLUE header = "RECORD OF DRIVING HOURS - DAY WITH A SUPERVISING DRIVER"
- RED header = "RECORD OF DRIVING HOURS - NIGHT WITH A SUPERVISING DRIVER"  
- GREEN header = "RECORD OF DRIVING HOURS - DAY WITH AN ACT ADI"
- Grey/White with "ACT ACCREDITED DRIVER INSTRUCTOR PRACTICE" = ADI Stamp page

For each row with data, extract:
1. DATE (format: DD/MM/YYYY)
2. WEATHER CONDITIONS (if visible)
3. SUPERVISOR/ADI NAME
4. LICENCE/ADI NUMBER
5. START TIME (24hr format HH:MM)
6. FINISH TIME (24hr format HH:MM)
7. TOTAL TIME (in hours and minutes, e.g., "1:30" or "1.5")
8. Whether signature appears present (true/false)
9. ODOMETER START (if visible)
10. ODOMETER FINISH (if visible)

Also note:
- Any entries that appear illegible or unclear (mark as "UNCLEAR")
- Any obvious errors (e.g., finish time before start time)
- The page subtotal if visible

Respond in this exact JSON format:
{
    "pageType": "BLUE_DAY" | "RED_NIGHT" | "GREEN_ADI" | "ADI_STAMP",
    "pageNumber": <number if visible>,
    "entries": [
        {
            "rowNumber": 1,
            "date": "DD/MM/YYYY" or "UNCLEAR",
            "weather": "string or null",
            "supervisorName": "string or UNCLEAR",
            "licenceNumber": "string or UNCLEAR", 
            "startTime": "HH:MM" or "UNCLEAR",
            "finishTime": "HH:MM" or "UNCLEAR",
            "totalTime": "H:MM" or decimal hours or "UNCLEAR",
            "hasSignature": true/false,
            "odometerStart": number or null,
            "odometerFinish": number or null,
            "confidence": "high" | "medium" | "low",
            "notes": "any issues or observations"
        }
    ],
    "subtotal": "H:MM if visible on page",
    "pageNotes": "any overall observations about the page quality or issues"
}

Be extremely careful with handwritten numbers - common confusions:
- 1 vs 7
- 0 vs 6
- 4 vs 9
- 5 vs 6

If uncertain, mark confidence as "low" and add a note.`;

        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: 4096,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/jpeg',
                                data: base64Image
                            }
                        },
                        {
                            type: 'text',
                            text: prompt
                        }
                    ]
                }]
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API Error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        const content = data.content[0].text;
        
        // Parse JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Could not parse extraction result');
        }
        
        return JSON.parse(jsonMatch[0]);
    }

    /**
     * Validate extracted entries and flag errors
     */
    validateEntries(extractionResult) {
        const errors = [];
        const warnings = [];
        const validatedEntries = [];
        
        let totalMinutes = 0;
        const today = new Date();
        today.setHours(23, 59, 59, 999);

        for (const entry of extractionResult.entries) {
            const entryErrors = [];
            const entryWarnings = [];
            
            // 1. Check for unclear/missing data
            if (entry.date === 'UNCLEAR') {
                entryErrors.push({ field: 'date', message: 'Date is unclear or illegible' });
            }
            if (entry.startTime === 'UNCLEAR' || entry.finishTime === 'UNCLEAR') {
                entryErrors.push({ field: 'time', message: 'Start or finish time is unclear' });
            }
            if (entry.totalTime === 'UNCLEAR') {
                entryWarnings.push({ field: 'totalTime', message: 'Total time is unclear - will calculate from start/finish' });
            }
            
            // 2. Parse and validate date
            let parsedDate = null;
            if (entry.date && entry.date !== 'UNCLEAR') {
                parsedDate = this.parseDate(entry.date);
                
                if (!parsedDate) {
                    entryErrors.push({ field: 'date', message: `Invalid date format: ${entry.date}` });
                } else if (parsedDate > today) {
                    entryErrors.push({ field: 'date', message: 'Date is in the future', severity: 'error' });
                } else if (parsedDate < this.validationRules.earliestDate) {
                    entryWarnings.push({ field: 'date', message: 'Date seems unusually old' });
                }
            }
            
            // 3. Parse and validate times
            let startMinutes = null;
            let finishMinutes = null;
            let calculatedDuration = null;
            
            if (entry.startTime && entry.startTime !== 'UNCLEAR') {
                startMinutes = this.parseTime(entry.startTime);
                if (startMinutes === null) {
                    entryErrors.push({ field: 'startTime', message: `Invalid start time: ${entry.startTime}` });
                }
            }
            
            if (entry.finishTime && entry.finishTime !== 'UNCLEAR') {
                finishMinutes = this.parseTime(entry.finishTime);
                if (finishMinutes === null) {
                    entryErrors.push({ field: 'finishTime', message: `Invalid finish time: ${entry.finishTime}` });
                }
            }
            
            // 4. Calculate duration and compare
            if (startMinutes !== null && finishMinutes !== null) {
                // Handle overnight sessions
                if (finishMinutes < startMinutes) {
                    finishMinutes += 24 * 60; // Add 24 hours
                }
                
                calculatedDuration = finishMinutes - startMinutes;
                
                // Validate duration
                if (calculatedDuration < this.validationRules.minSessionMinutes) {
                    entryErrors.push({ 
                        field: 'duration', 
                        message: `Session too short (${calculatedDuration} mins) - possible time entry error` 
                    });
                }
                
                if (calculatedDuration > this.validationRules.maxSessionHours * 60) {
                    entryWarnings.push({ 
                        field: 'duration', 
                        message: `Session over ${this.validationRules.maxSessionHours} hours (${(calculatedDuration/60).toFixed(1)} hrs) - break required after 2 hours` 
                    });
                }
                
                // Compare with recorded total
                if (entry.totalTime && entry.totalTime !== 'UNCLEAR') {
                    const recordedMinutes = this.parseDuration(entry.totalTime);
                    if (recordedMinutes !== null) {
                        const diff = Math.abs(calculatedDuration - recordedMinutes);
                        if (diff > 5) { // More than 5 minute discrepancy
                            entryErrors.push({ 
                                field: 'totalTime', 
                                message: `Time mismatch: recorded ${this.formatDuration(recordedMinutes)} but calculated ${this.formatDuration(calculatedDuration)}`,
                                calculated: calculatedDuration,
                                recorded: recordedMinutes
                            });
                        }
                    }
                }
                
                totalMinutes += calculatedDuration;
            }
            
            // 5. Check signature
            if (!entry.hasSignature) {
                entryWarnings.push({ field: 'signature', message: 'Signature appears to be missing' });
            }
            
            // 6. Check odometer (if both present)
            if (entry.odometerStart && entry.odometerFinish) {
                const distance = entry.odometerFinish - entry.odometerStart;
                if (distance < 0) {
                    entryErrors.push({ field: 'odometer', message: 'Odometer finish is less than start' });
                } else if (distance > 200 && calculatedDuration) {
                    const avgSpeed = distance / (calculatedDuration / 60);
                    if (avgSpeed > 100) {
                        entryWarnings.push({ 
                            field: 'odometer', 
                            message: `High average speed (${avgSpeed.toFixed(0)} km/h) - check odometer readings` 
                        });
                    }
                }
            }
            
            // 7. Low confidence warning
            if (entry.confidence === 'low') {
                entryWarnings.push({ field: 'general', message: 'Low confidence extraction - please verify' });
            }
            
            // Add validated entry
            validatedEntries.push({
                ...entry,
                parsedDate,
                calculatedDuration,
                durationMinutes: calculatedDuration || this.parseDuration(entry.totalTime),
                errors: entryErrors,
                warnings: entryWarnings,
                isValid: entryErrors.length === 0
            });
            
            // Aggregate errors/warnings
            entryErrors.forEach(e => errors.push({ row: entry.rowNumber, ...e }));
            entryWarnings.forEach(w => warnings.push({ row: entry.rowNumber, ...w }));
        }

        // Calculate totals
        const pageTypeConfig = this.pageTypes[extractionResult.pageType] || this.pageTypes.BLUE_DAY;
        
        const totals = {
            entries: validatedEntries.length,
            validEntries: validatedEntries.filter(e => e.isValid).length,
            totalMinutes: totalMinutes,
            totalHours: totalMinutes / 60,
            formattedTotal: this.formatDuration(totalMinutes)
        };

        // Compare with page subtotal if present
        if (extractionResult.subtotal) {
            const pageSubtotalMinutes = this.parseDuration(extractionResult.subtotal);
            if (pageSubtotalMinutes !== null) {
                const diff = Math.abs(totalMinutes - pageSubtotalMinutes);
                if (diff > 5) {
                    warnings.push({
                        row: 'subtotal',
                        field: 'subtotal',
                        message: `Page subtotal (${extractionResult.subtotal}) doesn't match sum of entries (${totals.formattedTotal})`
                    });
                }
            }
        }

        return {
            success: true,
            pageType: extractionResult.pageType,
            pageTypeInfo: pageTypeConfig,
            pageNumber: extractionResult.pageNumber,
            entries: validatedEntries,
            totals,
            errors,
            warnings,
            hasErrors: errors.length > 0,
            hasWarnings: warnings.length > 0,
            pageNotes: extractionResult.pageNotes,
            scannedAt: new Date().toISOString()
        };
    }

    /**
     * Parse date string (DD/MM/YYYY format)
     */
    parseDate(dateStr) {
        if (!dateStr) return null;
        
        // Try DD/MM/YYYY
        const parts = dateStr.split(/[\/\-\.]/);
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            
            // Handle 2-digit year
            const fullYear = year < 100 ? (year > 50 ? 1900 + year : 2000 + year) : year;
            
            const date = new Date(fullYear, month, day);
            if (!isNaN(date.getTime())) {
                return date;
            }
        }
        
        return null;
    }

    /**
     * Parse time string (HH:MM format) to minutes since midnight
     */
    parseTime(timeStr) {
        if (!timeStr) return null;
        
        const match = timeStr.match(/(\d{1,2})[:\.](\d{2})/);
        if (match) {
            const hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            
            if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                return hours * 60 + minutes;
            }
        }
        
        return null;
    }

    /**
     * Parse duration string (H:MM or decimal) to minutes
     */
    parseDuration(durationStr) {
        if (!durationStr) return null;
        
        // Handle H:MM format
        const colonMatch = durationStr.match(/(\d+)[:\.](\d{2})/);
        if (colonMatch) {
            return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
        }
        
        // Handle decimal hours (e.g., "1.5")
        const decimalMatch = durationStr.match(/(\d+\.?\d*)/);
        if (decimalMatch) {
            return Math.round(parseFloat(decimalMatch[1]) * 60);
        }
        
        return null;
    }

    /**
     * Format minutes to H:MM string
     */
    formatDuration(minutes) {
        if (minutes === null || minutes === undefined) return '--:--';
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return `${h}:${m.toString().padStart(2, '0')}`;
    }

    /**
     * Get cumulative hours across multiple scans
     */
    static calculateCumulativeHours(scanResults) {
        const totals = {
            blueDayMinutes: 0,
            redNightMinutes: 0,
            greenAdiMinutes: 0,
            adiStampMinutes: 0,
            allEntries: [],
            errorCount: 0,
            warningCount: 0
        };

        for (const scan of scanResults) {
            const validEntries = scan.entries.filter(e => e.isValid);
            
            switch (scan.pageType) {
                case 'BLUE_DAY':
                    totals.blueDayMinutes += validEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
                    break;
                case 'RED_NIGHT':
                    totals.redNightMinutes += validEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
                    break;
                case 'GREEN_ADI':
                case 'ADI_STAMP':
                    totals.greenAdiMinutes += validEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
                    break;
            }
            
            totals.allEntries.push(...scan.entries);
            totals.errorCount += scan.errors.length;
            totals.warningCount += scan.warnings.length;
        }

        // Calculate ADI credit (first 10 hours = 3x, rest = 1x)
        const adiActualHours = totals.greenAdiMinutes / 60;
        const adiFirst10Credit = Math.min(adiActualHours, 10) * 3;
        const adiExtraCredit = Math.max(0, adiActualHours - 10);
        const adiTotalCredit = adiFirst10Credit + adiExtraCredit;

        return {
            supervised: {
                dayHours: totals.blueDayMinutes / 60,
                nightHours: totals.redNightMinutes / 60,
                totalHours: (totals.blueDayMinutes + totals.redNightMinutes) / 60
            },
            adi: {
                actualHours: adiActualHours,
                creditHours: adiTotalCredit,
                first10Credit: adiFirst10Credit,
                extraCredit: adiExtraCredit
            },
            grandTotal: {
                actualHours: (totals.blueDayMinutes + totals.redNightMinutes + totals.greenAdiMinutes) / 60,
                creditedHours: (totals.blueDayMinutes + totals.redNightMinutes) / 60 + adiTotalCredit
            },
            validation: {
                totalEntries: totals.allEntries.length,
                errorCount: totals.errorCount,
                warningCount: totals.warningCount
            }
        };
    }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LogbookScanner;
}
if (typeof window !== 'undefined') {
    window.LogbookScanner = LogbookScanner;
}

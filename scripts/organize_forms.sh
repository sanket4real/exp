#!/bin/bash

# Define base directories
SOURCE_DIR="./uploads"
PUBLIC_PDF_FORM="../public/pdf-form"
APP_DIGITAL_FORMS="../app/digital-forms"
DB_SCHEMA_DIR="../app/digital-forms/dbSchema"
CONFIG_FILE="../app/digital-forms/digital.config.ts"
LOCK_FILE="/tmp/digital_script.lock"

# Ensure required directories exist
mkdir -p "$PUBLIC_PDF_FORM"
mkdir -p "$APP_DIGITAL_FORMS"
mkdir -p "$DB_SCHEMA_DIR"

# Prevent multiple instances from running simultaneously
if [[ -f "$LOCK_FILE" ]]; then
    echo "⚠️ Script is already running. Exiting to prevent conflicts."
    exit 1
fi
touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT # Remove lock file on exit

# Function to get the next available dXXX number
get_next_id() {
    local base_path="$PUBLIC_PDF_FORM"
    mkdir -p "$base_path" # Ensure the directory exists

    # Find the highest numbered dXXX file
    last_entry=$(find "$base_path" -maxdepth 1 -type d -name "d[0-9][0-9][0-9]" 2>/dev/null | sed -E 's/.*\/d([0-9]{3})/\1/' | sort -n | tail -n 1)

    if [[ -z "$last_entry" ]]; then
        echo "d001"
    else
        last_number=$((10#$last_entry)) # Convert to decimal
        next_number=$((last_number + 1))
        printf "d%03d" "$next_number"
    fi
}

# Check if there are any folders in uploads/
has_folders=false
for dir in "$SOURCE_DIR"/*; do
    if [[ -d "$dir" ]]; then
        has_folders=true
        break
    fi
done

if [[ "$has_folders" == false ]]; then
    echo "⚠️ No folders found in $SOURCE_DIR. Exiting script."
    exit 0
fi

# Backup existing config
cp "$CONFIG_FILE" "$CONFIG_FILE.bak"

# Extract existing imports
existing_imports=$(grep -E "^import df[0-9]{3}Schema" "$CONFIG_FILE" || echo "")

# Extract existing config (preserving everything before `export default`)
existing_config=$(sed -n '/const digitalFormsConfig:/,/};/p' "$CONFIG_FILE" | sed '$d')

# Check if `digitalFormsConfig` exists in the file
if grep -q "const digitalFormsConfig:" "$CONFIG_FILE"; then
    first_time=false
else
    first_time=true
    existing_config="const digitalFormsConfig: Record<string, DigitalForm> = {"
fi

# Remove any incorrect leading comma
existing_config=$(echo "$existing_config" | sed 's/^,\s*//')

# Ensure the last existing entry ends with a comma **only if there are existing entries**
if [[ "$first_time" == false && -n "$existing_config" && "$existing_config" != "const digitalFormsConfig: Record<string, DigitalForm> = {" ]]; then
    existing_config=$(echo "$existing_config" | sed '$s/,$//')","
fi

# Initialize new entries
new_imports=""
new_config=""

# Process each subdirectory in uploads/
for dir in "$SOURCE_DIR"/*; do
    if [[ -d "$dir" ]]; then
        folder_name=$(basename "$dir" | sed 's/[^a-zA-Z0-9_-]/ /g') # Sanitize folder name
        FORM_ID=$(get_next_id)
        IMAGE_FOLDER="$PUBLIC_PDF_FORM/$FORM_ID"
        JSON_FOLDER="$APP_DIGITAL_FORMS/[id]/temp-schema"
        SCHEMA_FILE="$DB_SCHEMA_DIR/$FORM_ID.txt"

        mkdir -p "$IMAGE_FOLDER"
        mkdir -p "$JSON_FOLDER"

        echo "$(date +"%Y-%m-%d %H:%M:%S") - 📂 Processing folder: $dir → FORM_ID: $FORM_ID"

        # Initialize image counter
        image_count=0
        image_paths=()

        for file in "$dir"/*; do
            if [[ -f "$file" ]]; then
                ext="${file##*.}"
                ext_lower=$(echo "$ext" | tr '[:upper:]' '[:lower:]')

                if [[ "$ext_lower" == "png" || "$ext_lower" == "jpg" || "$ext_lower" == "jpeg" ]]; then
                    new_filename="page-${image_count}.${ext_lower}"
                    cp "$file" "$IMAGE_FOLDER/$new_filename"
                    image_paths+=("\"/pdf-form/$FORM_ID/$new_filename\"")
                    ((image_count++))
                elif [[ "$ext_lower" == "json" ]]; then
                    json_filename="${FORM_ID}.json"
                    cp "$file" "$JSON_FOLDER/$json_filename"
                fi
            fi
        done

        # Create new schema text file
        echo "📝 Creating schema file: $SCHEMA_FILE"
        cat <<EOF >"$SCHEMA_FILE"
[
    {
        "id": {
            "\$oid": ""
        },
        "_class": "",
        "category": "",
        "description": "$folder_name",
        "enabled": "",
        "formId": "$FORM_ID",
        "img": {
            "\$binary": {
                "base64": "",
                "subType": ""
            }
        },
        "journey": "",
        "name": "$folder_name",
        "type": "",
        "wowJourney": {
            "exists": false,
            "reasonForNotTaking": [],
            "link": ""
        }
    }
]
EOF
        chmod 644 "$SCHEMA_FILE" # Ensure proper file permissions

        # Append new imports
        schema_var="df${FORM_ID:1}Schema"
        new_imports+="import $schema_var from \"./[id]/temp-schema/$FORM_ID.json\";\n"

        # Append new config entry
        new_config+="\t$FORM_ID: {\n"
        new_config+="\t\timages: [$(
            IFS=,
            echo "${image_paths[*]}"
        )],\n"
        new_config+="\t\tschema: $schema_var,\n"
        new_config+="\t\tmultipleCustomers: true,\n"
        new_config+="\t},\n"
    fi
done

# Construct final config file
{
    echo -e "$existing_imports\n$new_imports" | sort -V | uniq # Sort imports properly
    echo -e "\n$existing_config"

    # If it's the first time, avoid adding a comma before the first entry
    if [[ "$first_time" == true ]]; then
        echo -e "$new_config" | sed '1s/^,//'
    else
        echo -e "$new_config"
    fi

    echo -e "};\n\nexport default digitalFormsConfig;"
} >"$CONFIG_FILE"

echo "$(date +"%Y-%m-%d %H:%M:%S") - ✅ Done!"

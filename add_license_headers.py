#!/usr/bin/env python3
"""
Script to add Apache 2.0 license headers to files derived from Suna
Run this on any files that contain code adapted from https://github.com/kortix-ai/suna
"""

import os
import sys

# License header template for Python files
PYTHON_HEADER = '''# Copyright 2025 Cheatcode AI
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Portions of this file are derived from Suna by Kortix AI
# (https://github.com/kortix-ai/suna) under the Apache License 2.0

'''

# License header template for TypeScript/JavaScript files
JS_HEADER = '''/*
 * Copyright 2025 Cheatcode AI
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Portions of this file are derived from Suna by Kortix AI
 * (https://github.com/kortix-ai/suna) under the Apache License 2.0
 */

'''

def add_header_to_file(file_path, header):
    """Add license header to a file if it doesn't already have one"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check if file already has a license header
        if 'Licensed under the Apache License' in content:
            print(f"✓ {file_path} already has license header")
            return
        
        # Add header at the beginning
        new_content = header + content
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        
        print(f"✓ Added license header to {file_path}")
    
    except Exception as e:
        print(f"✗ Error processing {file_path}: {e}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python add_license_headers.py <file1> [file2] ...")
        print("\nExample:")
        print("python add_license_headers.py backend/agent/tools/*.py")
        print("python add_license_headers.py frontend/src/hooks/use-agent.ts")
        sys.exit(1)
    
    for file_path in sys.argv[1:]:
        if not os.path.exists(file_path):
            print(f"✗ File not found: {file_path}")
            continue
        
        if file_path.endswith(('.py', '.pyx')):
            add_header_to_file(file_path, PYTHON_HEADER)
        elif file_path.endswith(('.ts', '.tsx', '.js', '.jsx')):
            add_header_to_file(file_path, JS_HEADER)
        else:
            print(f"? Skipped {file_path} (unsupported file type)")

if __name__ == "__main__":
    main()

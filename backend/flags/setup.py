#!/usr/bin/env python3
import sys
import argparse
import asyncio
from flags import enable_flag, disable_flag, is_enabled, list_flags, delete_flag, get_flag_details

async def enable_command(flag_name: str, description: str = ""):
    if await enable_flag(flag_name, description):
        print(f"✓ Enabled flag: {flag_name}")
        if description:
            print(f"  Description: {description}")
    else:
        print(f"✗ Failed to enable flag: {flag_name}")


async def disable_command(flag_name: str, description: str = ""):
    if await disable_flag(flag_name, description):
        print(f"✓ Disabled flag: {flag_name}")
        if description:
            print(f"  Description: {description}")
    else:
        print(f"✗ Failed to disable flag: {flag_name}")


async def list_command():
    flags = await list_flags()
    
    if not flags:
        print("No feature flags found.")
        return
    
    print("Feature Flags:")
    print("-" * 50)
    
    for flag_name, enabled in flags.items():
        details = await get_flag_details(flag_name)
        description = details.get('description', 'No description') if details else 'No description'
        updated_at = details.get('updated_at', 'Unknown') if details else 'Unknown'
        
        status_icon = "✓" if enabled else "✗"
        status_text = "ENABLED" if enabled else "DISABLED"
        
        print(f"{status_icon} {flag_name}: {status_text}")
        print(f"  Description: {description}")
        print(f"  Updated: {updated_at}")
        print()


async def status_command(flag_name: str):
    details = await get_flag_details(flag_name)
    
    if not details:
        print(f"✗ Flag '{flag_name}' not found.")
        return
    
    enabled = await is_enabled(flag_name)
    status_icon = "✓" if enabled else "✗"
    status_text = "ENABLED" if enabled else "DISABLED"
    
    print(f"Flag: {flag_name}")
    print(f"Status: {status_icon} {status_text}")
    print(f"Description: {details.get('description', 'No description')}")
    print(f"Updated: {details.get('updated_at', 'Unknown')}")


async def delete_command(flag_name: str):
    if not await get_flag_details(flag_name):
        print(f"✗ Flag '{flag_name}' not found.")
        return
    
    confirm = input(f"Are you sure you want to delete flag '{flag_name}'? (y/N): ")
    if confirm.lower() in ['y', 'yes']:
        if await delete_flag(flag_name):
            print(f"✓ Deleted flag: {flag_name}")
        else:
            print(f"✗ Failed to delete flag: {flag_name}")
    else:
        print("Cancelled.")


async def toggle_command(flag_name: str, description: str = ""):
    current_status = await is_enabled(flag_name)
    
    if current_status:
        await disable_command(flag_name, description)
    else:
        await enable_command(flag_name, description)


async def main():
    parser = argparse.ArgumentParser(
        description="Feature Flag Management Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python setup.py enable new_ui "Enable new user interface"
  python setup.py disable beta_features "Disable beta features"
  python setup.py list
  python setup.py status new_ui
  python setup.py toggle maintenance_mode "Toggle maintenance mode"
  python setup.py delete old_feature
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    # Enable command
    enable_parser = subparsers.add_parser('enable', help='Enable a feature flag')
    enable_parser.add_argument('flag_name', help='Name of the feature flag')
    enable_parser.add_argument('description', nargs='?', default='', help='Optional description')
    
    # Disable command
    disable_parser = subparsers.add_parser('disable', help='Disable a feature flag')
    disable_parser.add_argument('flag_name', help='Name of the feature flag')
    disable_parser.add_argument('description', nargs='?', default='', help='Optional description')
    
    # List command
    subparsers.add_parser('list', help='List all feature flags')
    
    # Status command
    status_parser = subparsers.add_parser('status', help='Show status of a feature flag')
    status_parser.add_argument('flag_name', help='Name of the feature flag')
    
    # Delete command
    delete_parser = subparsers.add_parser('delete', help='Delete a feature flag')
    delete_parser.add_argument('flag_name', help='Name of the feature flag')
    
    # Toggle command
    toggle_parser = subparsers.add_parser('toggle', help='Toggle a feature flag')
    toggle_parser.add_argument('flag_name', help='Name of the feature flag')
    toggle_parser.add_argument('description', nargs='?', default='', help='Optional description')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    try:
        if args.command == 'enable':
            await enable_command(args.flag_name, args.description)
        elif args.command == 'disable':
            await disable_command(args.flag_name, args.description)
        elif args.command == 'list':
            await list_command()
        elif args.command == 'status':
            await status_command(args.flag_name)
        elif args.command == 'delete':
            await delete_command(args.flag_name)
        elif args.command == 'toggle':
            await toggle_command(args.flag_name, args.description)
    except KeyboardInterrupt:
        print("\nOperation cancelled.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main()) 
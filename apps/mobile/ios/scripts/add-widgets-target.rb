#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the OverdeckWidgets widget extension (the counts-only Live Activity, PAN-4839 WI-7) to
# ios/App/App.xcodeproj, and the files the App target needs for it. Run on the Mac rig:
#
#   gem install --user-install xcodeproj
#   ruby apps/mobile/ios/scripts/add-widgets-target.rb
#
# Every step checks before it changes anything, so a second run prints "already present" and
# leaves project.pbxproj as it was.

require 'xcodeproj'

IOS_APP = File.expand_path('../App', __dir__)
PROJECT_PATH = File.join(IOS_APP, 'App.xcodeproj')
WIDGET = 'OverdeckWidgets'
WIDGET_BUNDLE_ID = 'ai.overdeck.app.widgets'
WIDGET_SOURCES = %w[OverdeckWidgetsBundle.swift OverdeckLiveActivityWidget.swift].freeze
SHARED_SOURCE = 'OverdeckActivityAttributes.swift'
APP_PLUGIN_SOURCE = 'OverdeckLiveActivityPlugin.swift'
ENTITLEMENTS = 'App/App.entitlements'
EMBED_PHASE = 'Embed Foundation Extensions'

project = Xcodeproj::Project.open(PROJECT_PATH)
app = project.targets.find { |t| t.name == 'App' } or abort('no App target')
changes = []

def group_for(project, name, changes)
  found = project.main_group.children.find { |c| c.isa == 'PBXGroup' && c.display_name == name }
  return found if found

  changes << "group #{name}"
  project.main_group.new_group(name, name)
end

def file_ref(group, name, changes)
  found = group.files.find { |f| f.path == name }
  return found if found

  changes << "file #{group.display_name}/#{name}"
  group.new_reference(name)
end

def add_source(target, ref, changes)
  return if target.source_build_phase.files_references.include?(ref)

  target.source_build_phase.add_file_reference(ref)
  changes << "#{ref.path} → #{target.name} sources"
end

# Source groups.
shared_group = group_for(project, 'Shared', changes)
widget_group = group_for(project, WIDGET, changes)
app_group = project.main_group.children.find { |c| c.isa == 'PBXGroup' && c.display_name == 'App' } or abort('no App group')
shared_ref = file_ref(shared_group, SHARED_SOURCE, changes)
widget_refs = WIDGET_SOURCES.map { |name| file_ref(widget_group, name, changes) }
file_ref(widget_group, 'Info.plist', changes)

# The widget extension target.
widget = project.targets.find { |t| t.name == WIDGET }
unless widget
  widget = project.new_target(:app_extension, WIDGET, :ios, '16.2', nil, :swift)
  changes << "target #{WIDGET}"
end
app_config = ->(name) { app.build_configurations.find { |c| c.name == name } }
widget.build_configurations.each do |config|
  from_app = app_config.call(config.name)&.build_settings || {}
  wanted = {
    'PRODUCT_BUNDLE_IDENTIFIER' => WIDGET_BUNDLE_ID,
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => "#{WIDGET}/Info.plist",
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'IPHONEOS_DEPLOYMENT_TARGET' => '16.2',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Automatic',
    'SKIP_INSTALL' => 'YES',
    'APPLICATION_EXTENSION_API_ONLY' => 'YES',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
    'MARKETING_VERSION' => from_app['MARKETING_VERSION'] || '1.0',
    'CURRENT_PROJECT_VERSION' => from_app['CURRENT_PROJECT_VERSION'] || '1',
  }
  wanted['DEVELOPMENT_TEAM'] = from_app['DEVELOPMENT_TEAM'] if from_app['DEVELOPMENT_TEAM']
  wanted.each do |key, value|
    # xcodeproj saves a space-separated list such as LD_RUNPATH_SEARCH_PATHS as an array.
    next if Array(config.build_settings[key]).join(' ') == value

    config.build_settings[key] = value
    changes << "#{WIDGET} #{config.name} #{key}"
  end
end
widget_refs.each { |ref| add_source(widget, ref, changes) }
add_source(widget, shared_ref, changes)

# The App target: the shared attributes, the plugin (WI-8, once it exists) and the embedded extension.
add_source(app, shared_ref, changes)
if File.exist?(File.join(IOS_APP, 'App', APP_PLUGIN_SOURCE))
  add_source(app, file_ref(app_group, APP_PLUGIN_SOURCE, changes), changes)
end
unless app.dependencies.any? { |d| d.target == widget }
  app.add_dependency(widget)
  changes << "App depends on #{WIDGET}"
end
embed = app.copy_files_build_phases.find { |p| p.name == EMBED_PHASE }
unless embed
  embed = app.new_copy_files_build_phase(EMBED_PHASE)
  embed.dst_subfolder_spec = '13'
  embed.dst_path = ''
  changes << "phase #{EMBED_PHASE}"
end
unless embed.files_references.include?(widget.product_reference)
  build_file = embed.add_file_reference(widget.product_reference)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  changes << "embed #{WIDGET}.appex"
end

# D-10: an activity push token needs the Push Notifications capability (`aps-environment`).
entitlements_path = File.join(IOS_APP, ENTITLEMENTS)
plist = File.exist?(entitlements_path) ? Xcodeproj::Plist.read_from_path(entitlements_path) : {}
unless plist.key?('aps-environment')
  plist['aps-environment'] = 'development'
  Xcodeproj::Plist.write_to_path(plist, entitlements_path)
  changes << "#{ENTITLEMENTS} aps-environment"
end
file_ref(app_group, 'App.entitlements', changes)
app.build_configurations.each do |config|
  next if config.build_settings['CODE_SIGN_ENTITLEMENTS'] == ENTITLEMENTS

  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = ENTITLEMENTS
  changes << "App #{config.name} CODE_SIGN_ENTITLEMENTS"
end

if changes.empty?
  puts "#{WIDGET} already present"
  exit 0
end
project.save
puts "Updated #{PROJECT_PATH}:"
changes.each { |c| puts "  #{c}" }

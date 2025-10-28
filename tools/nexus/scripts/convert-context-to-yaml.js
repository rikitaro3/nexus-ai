#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function extractSection(content, startMarker, endMarker) {
  // Find the section containing "Context Map"
  const lines = content.split('\n');
  let startLineIdx = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^##\s+Context Map/)) {
      startLineIdx = i + 1; // Start from the line after the header
      break;
    }
  }
  
  if (startLineIdx === -1) return null;
  
  // Find the end (next section starting with ##)
  let endLineIdx = lines.length;
  for (let i = startLineIdx; i < lines.length; i++) {
    if (lines[i].match(/^##\s+/)) {
      endLineIdx = i;
      break;
    }
  }
  
  // Extract the section
  const sectionLines = lines.slice(startLineIdx, endLineIdx);
  return sectionLines.join('\n');
}

function convertMarkdownToYaml(markdownPath) {
  console.log(`Converting ${markdownPath}...`);
  
  const content = fs.readFileSync(markdownPath, 'utf8');
  const mapSection = extractSection(content, '## Context Map', '## ');
  
  if (!mapSection) {
    console.error('Context Map section not found');
    console.log('Content preview:', content.substring(0, 500));
    return;
  }
  
  console.log('Map section found, length:', mapSection.length);
  console.log('First 200 chars:', mapSection.substring(0, 200));
  
  const lines = mapSection.split('\n');
  const result = {
    version: '1.0',
    contextMap: []
  };
  
  let currentCategory = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check for category header
    const catMatch = trimmed.match(/^###\s+(.+)$/);
    if (catMatch) {
      currentCategory = catMatch[1];
      result.contextMap.push({
        category: currentCategory,
        entries: []
      });
      continue;
    }
    
    // Check for list item
    let itemMatch = trimmed.match(/^[-\*]\s+(.+?)\s+…\s+(.*)$/);
    if (!itemMatch) {
      // Try without ellipsis separator
      itemMatch = trimmed.match(/^[-\*]\s+(.+)/);
      if (itemMatch) {
        // This might be a description-only line, skip for now
        continue;
      }
    }
    
    if (itemMatch) {
      const path = itemMatch[1].trim();
      const description = itemMatch[2] ? itemMatch[2].trim() : '';
      
      // Skip if not a valid entry (starts with ** or empty path)
      if (path.startsWith('**') || !path) {
        continue;
      }
      
      if (currentCategory) {
        const lastCat = result.contextMap[result.contextMap.length - 1];
        if (lastCat && lastCat.category === currentCategory) {
          lastCat.entries.push({
            path,
            description
          });
        }
      }
    }
  }
  
  return result;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node convert-context-to-yaml.js <input.mdc> [output.yaml]');
    process.exit(1);
  }
  
  const inputPath = args[0];
  const outputPath = args[1] || inputPath.replace(/\.mdc$/, '.yaml');
  
  const result = convertMarkdownToYaml(inputPath);
  
  if (!result) {
    process.exit(1);
  }
  
  const yamlOutput = yaml.dump(result, {
    indent: 2,
    quotingType: '"',
    forceQuotes: false,
    lineWidth: -1
  });
  
  fs.writeFileSync(outputPath, yamlOutput, 'utf8');
  console.log(`✓ Converted to ${outputPath}`);
  console.log(`✓ ${result.contextMap.length} categories, ${result.contextMap.reduce((sum, cat) => sum + cat.entries.length, 0)} entries`);
}

if (require.main === module) {
  main();
}

module.exports = { convertMarkdownToYaml };

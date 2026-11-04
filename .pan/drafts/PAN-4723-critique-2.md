plan-digest: 11279bdae07f36ed65055b0302412f193c1294bedea24e21c11a27b53e104c49

## blocks-the-design: fixed-path cleanup can delete existing data

The optional checkpoint in `.pan/drafts/PAN-4723.md`, lines 188–194, uses `mkdir -p /run/user/1000/pan4723` and then `rm -rf /run/user/1000/pan4723`. `mkdir -p` also succeeds when that directory already exists, so the cleanup could erase files from a prior run or another process. My `stat` check found the path absent now, but the plan must be safe when executed later. Replace the fixed path with a uniquely created temporary directory, and clean it up only after verifying that this run created it. Omitting the optional checkpoint also resolves this finding.

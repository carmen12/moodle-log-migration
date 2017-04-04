
exports.make_alias = function(this_action, from_action){
    return () => {
        ['sql_match', 'fn', 'fixer'].forEach((x) => {
            if (library[this_action][x] === undefined){
                library[this_action][x] = library[from_action][x]
            }
        });
        if (library[this_action].sql_old === undefined){
            library[this_action].sql_old = library[from_action].sql_old.replace(new RegExp(from_action), this_action);
        }
    }
}

exports.bogus_email = function(x){
    // | id   | email                            |
    // +------+----------------------------------+
    // | 1542 | ed268db7fcf834e4ac18222e7252815a |
    // | 2128 | ed268db7fcf834e4ac18222e7252815a |
    // +------+----------------------------------+
    return  x.match(/^[a-f0-9]+$/) ||
            x.match(/^\s*$/);
}

exports.fix_by_shadow_index = function(log_row, old_matches, new_matches, cmp){
    if (!new_matches || old_matches.length > new_matches.length){
        console.error('fix_by_shadow_index -> too few new rows');
        return null;
    }
    var pos = -1;
    old_matches.forEach((m, i) => {
        if (cmp(log_row, m)){
            pos = i;
        }
    });
    if (pos < 0){
        console.error('fix_by_shadow_index -> impossible inconsistency in old matches');
        return null;
    }
    return new_matches[pos];
}

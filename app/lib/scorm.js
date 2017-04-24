var restrict_clause = require('./sql_restrictions.js')(),
    fix_by_match_index = require('./common.js').fix_by_match_index,
    mysql = require('mysql');

var library = {
    "add": undefined,
    "delete attempts": undefined,
    "launch": undefined,
    "pre-view": undefined,
    "report": undefined,
    "update": undefined,
    "userreport": undefined,
    "view": {
        /*
        This case has to do two-pass matching to extract the scoid from the url and
        then query mdl_scorm_scoers:

        | userid | course |  cmid | url                             | info |
        +--------+--------+-------+---------------------------------+------+
        |      2 |     18 |   315 | player.php?id=315&scoid=26      | 13   |
        |   3118 |    274 | 24161 | player.php?cm=24161&scoid=9879  | 2216 |
             |         |       |                               |        |
        mdl_user.id    |       |                               |        |
                mdl_course.id  |                               |        |
                      mdl_course_modules.id                    |        |
                                                    mdl_scorm_scoes.id  |
                                                                    mdl_scorm.id

        This case doesn't need pass 2, but needs different matching:

        | userid | course |  cmid | url                             | info |
        +--------+--------+-------+---------------------------------+------+
        |   1808 |    274 | 24161 | player.php?cm=24161&scoid=      | 2216 | (Broken, can't fix)

        ========
         PASS 1
        ========

        select course,cmid,url from mdl_log where module='scorm' and action='view' and id=2157709;
        +--------+-------+--------------------------------+
        | course | cmid  | url                            |
        +--------+-------+--------------------------------+
        |    274 | 24161 | player.php?cm=24161&scoid=9879 |
        +--------+-------+--------------------------------+

        select course,instance from mdl_course_modules where id=24161;
        +--------+----------+
        | course | instance |
        +--------+----------+
        |    274 |     2216 |
        +--------+----------+

        select shortname from mdl_course where id=274;
        +----------------------+
        | shortname            |
        +----------------------+
        | PPD_FirstQuarter2015 |
        +----------------------+

        select course,name,reference from mdl_scorm where id=2216;
        +--------+-----------------------------+-------------------+
        | course | name                        | reference         |
        +--------+-----------------------------+-------------------+
        |    274 | The Phases of Project Cycle | Project Cycle.zip |
        +--------+-----------------------------+-------------------+

        ========
         PASS 2
        ========

        select scorm,identifier,title from mdl_scorm_scoes where id=9879;
        +-------+----------------------------------+------------------------------+
        | scorm | identifier                       | title                        |
        +-------+----------------------------------+------------------------------+
        |  2216 | The_Phases_of_Project_Cycle__SCO | The Phases of Project Cycle  |
        +-------+----------------------------------+------------------------------+

        ============================
         REVERSE MATCH (with scoid)
        ============================

        select  c.shortname, o.id as sco_id, o.scorm as sco_scorm, o.identifier as
                sco_ident, s.name as scorm_name, s.reference as scorm_ref, s.course
                as scorm_course from mdl_scorm_scoes o join mdl_scorm s on s.id=o.scorm
                join mdl_course c on c.id=s.course where o.title='The Phases of
                Project Cycle' and o.identifier='The_Phases_of_Project_Cycle__SCO'
                and c.shortname='PPD_FirstQuarter2015';

        +----------------------+--------+-----------+----------------------------------+...
        | shortname            | sco_id | sco_scorm | sco_ident                        |...
        +----------------------+--------+-----------+----------------------------------+...
        | PPD_FirstQuarter2015 |   9879 |      2216 | The_Phases_of_Project_Cycle__SCO |...

                                    ...+-----------------------------+-------------------+--------------+
                                    ...| scorm_name                  | scorm_ref         | scorm_course |
                                    ...+-----------------------------+-------------------+--------------+
                                    ...| The Phases of Project Cycle | Project Cycle.zip |          274 |

        app_1           |   mdl_log.scorm.view.count: 31043
        app_1           |   mdl_log.scorm.view.multiple_matches: 325
        app_1           |   mdl_log.scorm.view.multiple_matches_fixed: 325
        app_1           |   mdl_log.scorm.view.no_matches: 10
        app_1           |   mdl_log.scorm.view.no_matches_p2: 15755
        app_1           |   mdl_log.scorm.view.time: 78279ms

        app_1           |   mdl_log.scorm.view.count: 15278
        app_1           |   mdl_log.scorm.view.multiple_matches: 325
        app_1           |   mdl_log.scorm.view.multiple_matches_fixed: 325
        app_1           |   mdl_log.scorm.view.time: 64329ms

        */
        sql_old:    'SELECT log.*, ' +
                    '       u.email, u.username, ' +
                    '       s.name AS scorm_name, s.reference AS scorm_reference, ' +
                    '       o.id AS sco_id, ' +
                    '       o.identifier AS sco_identifier, ' +
                    '       o.title AS sco_title, ' +
                    '       c.shortname AS course_shortname ' +
                    'FROM mdl_log log ' +
                    'JOIN mdl_user u ON u.id = log.userid ' +
                    'JOIN mdl_scorm s ON s.id = log.cmid ' +
                    "LEFT JOIN mdl_scorm_scoes o ON o.id = " +
                    "       (select reverse(" +
                    "           substr(" +
                    "               reverse(log.url)," +
                    "               1," +
                    "               locate('=', reverse(log.url))-1" +
                    "           )" +
                    "       )) " +
                    'JOIN mdl_course c ON c.id = log.course ' +
                    "WHERE log.module = 'scorm' AND log.action = 'view' AND " + restrict_clause,

        sql_match:  (row) => {
            return row.sco_title ?
                    mysql.format(
                        'SELECT c.id AS course, ' +
                        '       o.id AS sco_id, o.title AS sco_title, o.identifier AS sco_identifier, ' +
                        '       s.id AS scorm_id, ' + 
                        '       cm.id AS cmid, ' +
                        '       u.id AS userid, u.username ' +
                        'FROM mdl_scorm_scoes o ' +
                        'JOIN mdl_scorm s ON s.id = o.scorm ' +
                        'JOIN mdl_course c ON c.id=s.course ' +
                        'JOIN mdl_course_modules cm ON cm.instance=s.id AND cm.course=c.id ' +
                        'JOIN mdl_user u ON BINARY u.email = ? ' +
                        'WHERE o.title = ? AND o.identifier=? AND c.shortname = ?',
                        [
                            row["email"],
                            row["sco_title"],
                            row["sco_identifier"],
                            row["course_shortname"]
                        ]
                    )
                    :
                    mysql.format(
                        'SELECT c.id AS course, ' +
                        '       s.id AS scorm_id, ' +
                        '       cm.id AS cmid, ' +
                        '       u.id AS userid, u.username ' +
                        'FROM mdl_course c ' +
                        'JOIN mdl_scorm s ON s.name = ? and s.course=c.id ' +
                        'JOIN mdl_course_modules cm ON cm.instance=s.id AND cm.course=c.id ' +
                        'JOIN mdl_user u ON BINARY u.email = ? ' +
                        'WHERE c.shortname = ?',
                        [
                            row["scorm_name"],
                            row["email"],
                            row["course_shortname"]
                        ]
                    );
        },

        match_failed_because_of_known_bad_data: (row) => {
            return row.course_shortname === 'PMSBConcepts';
        },

        format: {
            'no_matches': (row) => {
                return 'no matches for course="' + row.course_shortname +
                                    '", user="' + row.username +
                                    '", sco="' + row.sco_title +
                                    '", scorm="' + row.scorm_name + '"';
            }
        },

        fixer: function(log_row, old_matches, new_matches){
            return fix_by_match_index(log_row, old_matches, new_matches, (lr, nm) => {
                return lr.username === nm.username;
            });
        },

        fn: function(old_row, match_row, next){
            match_row.sco_id = match_row.sco_id || '';
            var updated_url = old_row.url
                                .replace(/\?id=\d+/, '?id=' + match_row.cmid)
                                .replace(/cm=\d+/, 'cm=' + match_row.cmid)
                                .replace(/scoid=\d+/, 'scoid=' + match_row.sco_id);
            var output ='INSERT INTO mdl_log ' +
                        '(time,userid,ip,course,module,cmid,action,url,info) VALUES ' +
                        '(' +
                            [
                                old_row.time,
                                match_row.userid,
                                "'" + old_row.ip + "'",
                                match_row.course,
                                "'" + old_row.module + "'",
                                match_row.cmid,
                                "'" + old_row.action + "'",
                                "'" + updated_url + "'",
                                "'" + match_row.scorm_id + "'"
                            ].join(',') +
                        ')';
            next && next(null, output);
        }
    },
    "view all": undefined
};

module.exports = library;
